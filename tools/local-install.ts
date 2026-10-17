import { homedir } from "node:os";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Data, Effect, FileSystem, Layer, Path } from "effect";

import { captureProcess, processRunnerLayer, runInherit } from "./capture-process.ts";
import { Workspace, workspaceLayer } from "./coding-agent-package.ts";
import { archiveFileNameFor, hostPlatformName, RELEASE_PLATFORMS } from "./release-platforms.ts";

const DEFAULT_OUT_DIR = [".artifacts", "binaries"];

class LocalInstallError extends Data.TaggedError("LocalInstallError")<{
  readonly message: string;
}> {}

const makeContext = () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const { repoRoot, version } = yield* workspace.loadCodingAgentPackage;
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
    const fs = yield* FileSystem.FileSystem;
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
    const path = yield* Path.Path;
    const platform = RELEASE_PLATFORMS.find((candidate) => candidate.name === hostPlatformName());
    if (platform === undefined) {
      return yield* new LocalInstallError({
        message: `unsupported host platform: ${process.platform} ${process.arch}`,
      });
    }
    if (platform.archive !== "tar.gz") {
      return yield* new LocalInstallError({
        message: `unsupported archive format: ${platform.archive}`,
      });
    }
    const outDir = path.join(repoRoot, ...DEFAULT_OUT_DIR);
    const archiveName = archiveFileNameFor(platform);
    const archivePath = path.join(outDir, archiveName);
    return {
      fs,
      path,
      repoRoot,
      archivePath,
      installDir: path.join(homedir(), ".local", "share", "msa"),
      linkPath: path.join(homedir(), ".local", "bin", "msa"),
      executable: platform.executable,
      platformName: platform.name,
      version,
    };
  });

type Context = Effect.Success<ReturnType<typeof makeContext>>;

const install = (context: Context) =>
  Effect.gen(function* () {
    yield* context.fs.remove(context.installDir, { recursive: true, force: true });
    yield* context.fs.makeDirectory(context.installDir, { recursive: true });
    yield* runInherit({
      args: ["-xzf", context.archivePath, "-C", context.installDir, "--strip-components=1"],
      command: "tar",
      cwd: context.repoRoot,
    });
    yield* context.fs.makeDirectory(context.path.dirname(context.linkPath), { recursive: true });
    yield* context.fs.remove(context.linkPath, { force: true });
    yield* context.fs.symlink(
      context.path.join(context.installDir, context.executable),
      context.linkPath,
    );
  });

const verifyInstall = (context: Context) =>
  Effect.gen(function* () {
    const { exitCode, stderr, stdout } = yield* captureProcess({
      args: ["--version"],
      command: context.linkPath,
      cwd: context.repoRoot,
    });
    const reported = stdout.trim();
    if (exitCode !== 0 || reported !== context.version) {
      return yield* new LocalInstallError({
        message: `installed msa reported "${reported}" (exit ${exitCode}), expected ${context.version}:\n${stderr}`,
      });
    }
    yield* Console.log(
      `==> installed msa ${reported}: ${context.linkPath} -> ${context.path.join(context.installDir, context.executable)}`,
    );
  });

const program = Effect.gen(function* () {
  if (process.argv.length > 2) {
    return yield* new LocalInstallError({
      message: `unknown argument(s): ${process.argv.slice(2).join(", ")}`,
    });
  }
  const context = yield* makeContext();
  yield* Console.log(`==> installing msa ${context.version} for ${context.platformName}`);
  yield* runInherit({
    args: ["run", "build-binaries", context.platformName],
    command: "vp",
    cwd: context.repoRoot,
  });
  yield* install(context);
  yield* verifyInstall(context);
});

// oxlint-disable-next-line effecttsgo/unstable-api-usage -- v4 platform services are pre-GA
const mainLayer = Layer.mergeAll(NodeServices.layer, processRunnerLayer, workspaceLayer);

// oxlint-disable-next-line effecttsgo/unstable-api-usage, effecttsgo/strict-effect-provide -- application entry point on pre-GA v4 platform APIs
NodeRuntime.runMain(program.pipe(Effect.provide(mainLayer)));
