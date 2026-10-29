import { Config, Effect, Schema } from "effect";

import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import captureProcessModule from "./capture-process.ts";
import type hiddenBuildTreeTypes from "./hidden-build-tree.types.ts";

const { captureProcess } = captureProcessModule;

const HIDE_BUILD_TREE =
  'tree="$1"; uid="$2"; gid="$3"; shift 3; mount -t tmpfs tmpfs "$tree" && exec setpriv --reuid="$uid" --regid="$gid" --init-groups -- "$@"';

class HiddenBuildTreeError extends Schema.TaggedError<
  HiddenBuildTreeError,
  { readonly brand: unique symbol }
>()("HiddenBuildTreeError", { message: Schema.String }) {}

const canHideBuildTree = (workDir: string) =>
  process.platform === "linux"
    ? captureProcess({ args: ["-n", "true"], command: "sudo", cwd: workDir }).pipe(
        Effect.map(({ exitCode }) => exitCode === 0),
        Effect.orElseSucceed(() => false),
      )
    : Effect.succeed(false);

const processIds = () => [process.getuid, process.getgid].map((id) => String(id?.() ?? 0));

const hiddenTreeRunner = (repoRoot: string, binary: string): hiddenBuildTreeTypes.Runner => ({
  args: [
    "-n",
    "--preserve-env=MSA_CODING_AGENT_DIR,HOME",
    "unshare",
    "--mount",
    "--propagation",
    "private",
    "--",
    "sh",
    "-c",
    HIDE_BUILD_TREE,
    "sh",
    repoRoot,
    ...processIds(),
    binary,
  ],
  command: "sudo",
  name: "binary",
});

const visibleTreeRunner = (repoRoot: string, binary: string) =>
  Effect.gen(function* () {
    if ((yield* Config.String("CI").pipe(Config.withDefault(""))) === "true") {
      return yield* HiddenBuildTreeError.make({
        message: "CI must run the binary with the build tree hidden (Linux, sudo -n, unshare)",
      });
    }
    yield* scriptOutput.print(
      `==> the build tree ${repoRoot} stays visible to the binary: hiding it needs Linux and sudo -n`,
    );
    return { args: [], command: { msaBinary: binary }, name: "binary" };
  });

const binaryRunner = (binary: string, repoRoot: string, workDir: string) =>
  Effect.gen(function* () {
    return (yield* canHideBuildTree(workDir))
      ? hiddenTreeRunner(repoRoot, binary)
      : yield* visibleTreeRunner(repoRoot, binary);
  });

const hiddenBuildTree = { binaryRunner };

export default hiddenBuildTree;
