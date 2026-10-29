import { homedir } from "node:os";

import { Effect, Layer, Schema } from "effect";

import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import captureProcessModule from "./capture-process.ts";
import codingAgentPackage from "./coding-agent-package.ts";
import releasePlatforms from "./release-platforms.ts";

const { Workspace, workspaceLayer } = codingAgentPackage;
const { RELEASE_PLATFORMS, archiveFileNameFor, hostPlatformName } = releasePlatforms;
const { captureProcess, processRunnerLayer, runInherit } = captureProcessModule;
const { runMainWith } = scriptOutput;
const { ScriptOutput } = scriptOutput;

const DEFAULT_OUT_DIR = [".artifacts", "binaries"];

class LocalInstallError extends Schema.TaggedError<
  LocalInstallError,
  { readonly brand: unique symbol }
>()("LocalInstallError", { message: Schema.String }) {}

const makeContext = () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const { repoRoot, version } = yield* workspace.loadCodingAgentPackage;
    const { files: fs, path } = yield* scriptOutput.ScriptOutput;
    const platform = RELEASE_PLATFORMS.find((candidate) => candidate.name === hostPlatformName());
    if (platform === undefined) {
      return yield* LocalInstallError.make({
        message: `unsupported host platform: ${process.platform} ${process.arch}`,
      });
    }
    if (platform.archive !== "tar.gz") {
      return yield* LocalInstallError.make({
        message: `unsupported archive format: ${platform.archive}`,
      });
    }
    const outDir = path.join(repoRoot, ...DEFAULT_OUT_DIR);
    const archiveName = archiveFileNameFor(platform);
    const archivePath = path.join(outDir, archiveName);
    return {
      archivePath,
      executable: platform.executable,
      fs,
      installDir: path.join(homedir(), ".local", "share", "msa"),
      linkPath: path.join(homedir(), ".local", "bin", "msa"),
      path,
      platformName: platform.name,
      repoRoot,
      version,
    };
  });

type Context = Effect.Success<ReturnType<typeof makeContext>>;

const install = (context: Context) =>
  Effect.gen(function* () {
    yield* context.fs.remove(context.installDir);
    yield* context.fs.makeDirectory(context.installDir);
    yield* runInherit({
      args: ["-xzf", context.archivePath, "-C", context.installDir, "--strip-components=1"],
      command: "tar",
      cwd: context.repoRoot,
    });
    yield* context.fs.makeDirectory(context.path.dirname(context.linkPath));
    yield* context.fs.remove(context.linkPath);
    yield* (yield* ScriptOutput).linkPath(
      context.path.join(context.installDir, context.executable),
      context.linkPath,
    );
  });

const verifyInstall = (context: Context) =>
  Effect.gen(function* () {
    const { exitCode, stderr, stdout } = yield* captureProcess({
      args: ["--version"],
      command: { msaBinary: context.linkPath },
      cwd: context.repoRoot,
    });
    const reported = stdout.trim();
    if (exitCode !== 0 || reported !== context.version) {
      return yield* LocalInstallError.make({
        message: `installed msa reported "${reported}" (exit ${exitCode}), expected ${context.version}:\n${stderr}`,
      });
    }
    yield* scriptOutput.print(
      `==> installed msa ${reported}: ${context.linkPath} -> ${context.path.join(context.installDir, context.executable)}`,
    );
  });

const program = Effect.gen(function* () {
  if (process.argv.length > 2) {
    return yield* LocalInstallError.make({
      message: `unknown argument(s): ${process.argv.slice(2).join(", ")}`,
    });
  }
  const context = yield* makeContext();
  yield* scriptOutput.print(`==> installing msa ${context.version} for ${context.platformName}`);
  yield* runInherit({
    args: ["run", "build-binaries", context.platformName],
    command: "vp",
    cwd: context.repoRoot,
  });
  yield* install(context);
  yield* verifyInstall(context);
});

const mainLayer = Layer.mergeAll(processRunnerLayer, workspaceLayer);

runMainWith(program, mainLayer);
