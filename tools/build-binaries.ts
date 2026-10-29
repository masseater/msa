import { Config, Effect, Layer, Schema } from "effect";

import ScriptOutputError from "../libs/ai/src/utils/script-output-error.ts";
import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import captureProcessModule from "./capture-process.ts";
import codingAgentPackage from "./coding-agent-package.ts";
import releasePlatforms from "./release-platforms.ts";
import type releasePlatformsTypes from "./release-platforms.types.ts";

const {
  ARCHIVE_FLAGS,
  DIST_ENTRIES,
  RELEASE_PLATFORMS,
  archiveFileNameFor,
  archiveRootFor,
  hostPlatformName,
} = releasePlatforms;
const { Workspace, workspaceLayer } = codingAgentPackage;
const { captureProcess, processRunnerLayer, runInherit } = captureProcessModule;
const { runMainWith } = scriptOutput;

const DEFAULT_OUT_DIR = [".artifacts", "binaries"];
const SKIP_BUILD_FLAG = "--skip-build";
const LOCAL_LLM_TESTS_ENV = "MSA_LOCAL_LLM_TESTS";

const localLlmTests = Config.String(LOCAL_LLM_TESTS_ENV).pipe(
  Config.withDefault(""),
  Config.map((value) => value !== ""),
);

class BuildBinariesError extends Schema.TaggedError<
  BuildBinariesError,
  { readonly brand: unique symbol }
>()("BuildBinariesError", { message: Schema.String }) {}

type FileSystemError = ScriptOutputError;

const requestedPlatforms = () => {
  const requested = RELEASE_PLATFORMS.filter((platform) => process.argv.includes(platform.name));
  return requested.length > 0 ? requested : RELEASE_PLATFORMS;
};

const unknownArguments = () =>
  process.argv
    .slice(2)
    .filter((argument) =>
      argument.startsWith("--")
        ? argument !== SKIP_BUILD_FLAG
        : !RELEASE_PLATFORMS.some((platform) => platform.name === argument),
    );

const makeContext = () =>
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const { repoRoot, version } = yield* workspace.loadCodingAgentPackage;
    const output = yield* scriptOutput.ScriptOutput;
    const { files: fs, path } = output;
    return {
      codingAgentDir: path.join(repoRoot, "apps", "coding-agent"),
      decideSmoke: yield* localLlmTests,
      fs,
      outDir: path.join(repoRoot, ...DEFAULT_OUT_DIR),
      output,
      path,
      platforms: requestedPlatforms(),
      repoRoot,
      skipBuild: process.argv.includes(SKIP_BUILD_FLAG),
      tuiDir: path.join(repoRoot, "libs", "tui"),
      version,
    };
  });

type Context = Effect.Success<ReturnType<typeof makeContext>>;

const SKIPPED_ENTRIES = new Set(["node_modules", ".DS_Store"]);

const copyTree: (
  context: Context,
  source: string,
  destination: string,
) => Effect.Effect<void, FileSystemError> = (context, source, destination) =>
  Effect.gen(function* () {
    const info = yield* context.fs.stat(source);
    if (info.isDirectory) {
      yield* context.fs.makeDirectory(destination);
      const entries = yield* context.fs.readDirectory(source);
      for (const entry of entries.filter((name) => !SKIPPED_ENTRIES.has(name))) {
        yield* copyTree(
          context,
          context.path.join(source, entry),
          context.path.join(destination, entry),
        );
      }
      return;
    }
    yield* context.fs.makeDirectory(context.path.dirname(destination));
    yield* context.output.copyFileTo(source, destination);
  });

const workDirFor = (context: Context, platform: releasePlatformsTypes.ReleasePlatform) =>
  context.path.join(context.outDir, "work", platform.name);

const payloadDirFor = (context: Context, platform: releasePlatformsTypes.ReleasePlatform) => {
  const workDir = workDirFor(context, platform);
  return platform.archive === "zip" ? workDir : context.path.join(workDir, "msa");
};

const archivePathFor = (context: Context, platform: releasePlatformsTypes.ReleasePlatform) =>
  context.path.join(context.outDir, archiveFileNameFor(platform));

const prepareWorkspace = (context: Context) =>
  Effect.gen(function* () {
    if (context.skipBuild) {
      yield* scriptOutput.print("==> skipping the workspace build (--skip-build)");
    } else {
      yield* scriptOutput.print("==> building workspace packages (vp run build)");
      yield* runInherit({
        args: ["run", "--no-cache", "build"],
        command: "vp",
        cwd: context.repoRoot,
      });
    }
    yield* runInherit({
      args: ["run", "--no-cache", "--filter", "@msa/coding-agent", "copy-binary-assets"],
      command: "vp",
      cwd: context.repoRoot,
    });
  });

const copyPayload = (
  context: Context,
  platform: releasePlatformsTypes.ReleasePlatform,
  payloadDir: string,
) =>
  Effect.gen(function* () {
    for (const entry of DIST_ENTRIES) {
      yield* copyTree(
        context,
        context.path.join(context.codingAgentDir, "dist", entry),
        context.path.join(payloadDir, entry),
      );
    }
    yield* copyTree(
      context,
      context.path.join(context.tuiDir, platform.prebuilds),
      context.path.join(payloadDir, platform.prebuilds),
    );
  });

const buildPlatformArtifact = (context: Context, platform: releasePlatformsTypes.ReleasePlatform) =>
  Effect.gen(function* () {
    const payloadDir = payloadDirFor(context, platform);
    yield* context.fs.remove(workDirFor(context, platform));
    yield* context.fs.makeDirectory(payloadDir);
    yield* scriptOutput.print(`==> compiling ${platform.name} (${platform.bunTarget})`);
    yield* runInherit({
      args: [
        "build",
        "--compile",
        "--no-compile-autoload-bunfig",
        "--no-compile-autoload-dotenv",
        "--compile-autoload-package-json",
        "--external=node-llama-cpp",
        `--target=${platform.bunTarget}`,
        "./dist/bun/cli.js",
        "./dist/utils/image-resize-worker.js",
        "./dist/extensions/codemode/worker.js",
        `--outfile=${context.path.join(payloadDir, platform.executable)}`,
      ],
      command: "bun",
      cwd: context.codingAgentDir,
    });
    yield* copyPayload(context, platform, payloadDir);
    yield* runInherit({
      args: ["tools/deploy-node-llama-cpp.ts", platform.name, payloadDir],
      command: "node",
      cwd: context.repoRoot,
    });
    const archivePath = archivePathFor(context, platform);
    yield* context.fs.remove(archivePath);
    if (platform.archive === "zip") {
      yield* runInherit({ args: ["-r", "-q", archivePath, "."], command: "zip", cwd: payloadDir });
      return;
    }
    yield* runInherit({
      args: ["-czf", archivePath, "-C", context.path.dirname(payloadDir), "msa"],
      command: "tar",
      cwd: context.repoRoot,
    });
  });

const writeChecksums = (context: Context) =>
  Effect.gen(function* () {
    const lines: string[] = [];
    for (const platform of context.platforms) {
      const archivePath = archivePathFor(context, platform);
      const digest = yield* context.fs.sha256Hex(archivePath);
      lines.push(`${digest}  ${context.path.basename(archivePath)}`);
    }
    yield* context.output.writeTextFile(
      context.path.join(context.outDir, "SHA256SUMS"),
      `${lines.join("\n")}\n`,
    );
  });

const versionMatches = (expected: string, exitCode: number, reported: string) =>
  exitCode === 0 && reported === expected;

const decideSmokeTest = (context: Context, binary: string) =>
  context.decideSmoke
    ? runInherit({
        args: ["tools/smoke-binary-decide.ts", binary],
        command: "node",
        cwd: context.repoRoot,
      })
    : scriptOutput.print(
        `==> skipping the node-llama-cpp decide smoke test: set ${LOCAL_LLM_TESTS_ENV}=1 to run it`,
      );

const exportSmokeTest = (context: Context, binary: string) =>
  runInherit({
    args: ["tools/smoke-binary-export.ts", binary],
    command: "node",
    cwd: context.repoRoot,
  });

const smokeTest = (context: Context) =>
  Effect.gen(function* () {
    const host = hostPlatformName();
    const platform = context.platforms.find((candidate) => candidate.name === host);
    if (platform === undefined) {
      yield* scriptOutput.print(
        `==> skipping the smoke test: no ${host ?? "host"} archive in this run`,
      );
      return;
    }
    const smokeDir = context.path.join(context.outDir, "smoke");
    yield* context.fs.remove(smokeDir);
    yield* context.fs.makeDirectory(smokeDir);
    yield* runInherit({
      args: [ARCHIVE_FLAGS[platform.archive], archivePathFor(context, platform), "-C", smokeDir],
      command: "tar",
      cwd: context.repoRoot,
    });
    const binary = context.path.join(smokeDir, archiveRootFor(platform), platform.executable);
    const { exitCode, stderr, stdout } = yield* captureProcess({
      args: ["--version"],
      command: { msaBinary: binary },
      cwd: smokeDir,
    });
    const reported = stdout.trim();
    if (!versionMatches(context.version, exitCode, reported)) {
      return yield* BuildBinariesError.make({
        message: `${platform.name} reported "${reported}" (exit ${exitCode}), expected ${context.version}:\n${stderr}`,
      });
    }
    yield* scriptOutput.print(
      `==> ${platform.name} archive runs: msa --version reports ${reported}`,
    );
    yield* exportSmokeTest(context, binary);
    yield* decideSmokeTest(context, binary);
  });

const program = Effect.gen(function* () {
  const unknown = unknownArguments();
  if (unknown.length > 0) {
    return yield* BuildBinariesError.make({
      message: `unknown argument(s): ${unknown.join(", ")}`,
    });
  }
  const context = yield* makeContext();
  yield* scriptOutput.print(
    `==> msa ${context.version} for ${context.platforms.map((platform) => platform.name).join(", ")}`,
  );
  yield* prepareWorkspace(context);
  for (const platform of context.platforms) {
    yield* buildPlatformArtifact(context, platform);
  }
  yield* writeChecksums(context);
  yield* smokeTest(context);
  const rows: string[] = [];
  for (const platform of context.platforms) {
    const info = yield* context.fs.stat(archivePathFor(context, platform));
    rows.push(
      `    ${archiveFileNameFor(platform)}  ${(Number(info.size) / 1_048_576).toFixed(1)} MiB`,
    );
  }
  yield* scriptOutput.print(
    [
      `==> release assets in ${context.path.relative(context.repoRoot, context.outDir)}:`,
      ...rows,
      "    SHA256SUMS",
    ].join("\n"),
  );
});

const mainLayer = Layer.mergeAll(processRunnerLayer, workspaceLayer);

runMainWith(program, mainLayer);
