import { NodeServices } from "@effect/platform-node";
import { Console, Crypto, Data, Effect, FileSystem, Layer, Path } from "effect";
import type { PlatformError } from "effect";
import { Hex } from "effect/encoding";

import { captureProcess, processRunnerLayer, runInherit } from "./capture-process.ts";
import { Workspace, workspaceLayer } from "./coding-agent-package.ts";
import {
  ARCHIVE_FLAGS,
  DIST_ENTRIES,
  RELEASE_PLATFORMS,
  type ReleasePlatform,
  archiveFileNameFor,
  archiveRootFor,
  hostPlatformName,
} from "./release-platforms.ts";
import { runMainWith } from "./run-main.ts";

const DEFAULT_OUT_DIR = [".artifacts", "binaries"];
const SKIP_BUILD_FLAG = "--skip-build";

class BuildBinariesError extends Data.TaggedError("BuildBinariesError")<{
  readonly message: string;
}> {}

type FileSystemError = PlatformError.PlatformError;

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
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return {
      codingAgentDir: path.join(repoRoot, "apps", "coding-agent"),
      fs,
      outDir: path.join(repoRoot, ...DEFAULT_OUT_DIR),
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
    if (info.type === "Directory") {
      yield* context.fs.makeDirectory(destination, { recursive: true });
      const entries = yield* context.fs.readDirectory(source);
      for (const entry of entries) {
        if (SKIPPED_ENTRIES.has(entry)) {
          continue;
        }
        yield* copyTree(
          context,
          context.path.join(source, entry),
          context.path.join(destination, entry),
        );
      }
      return;
    }
    yield* context.fs.makeDirectory(context.path.dirname(destination), { recursive: true });
    yield* context.fs.copyFile(source, destination);
  });

const workDirFor = (context: Context, platform: ReleasePlatform) =>
  context.path.join(context.outDir, "work", platform.name);

const payloadDirFor = (context: Context, platform: ReleasePlatform) => {
  const workDir = workDirFor(context, platform);
  return platform.archive === "zip" ? workDir : context.path.join(workDir, "msa");
};

const archivePathFor = (context: Context, platform: ReleasePlatform) =>
  context.path.join(context.outDir, archiveFileNameFor(platform));

const prepareWorkspace = (context: Context) =>
  Effect.gen(function* () {
    if (context.skipBuild) {
      yield* Console.log("==> skipping the workspace build (--skip-build)");
    } else {
      yield* Console.log("==> building workspace packages (vp run build)");
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

const copyPayload = (context: Context, platform: ReleasePlatform, payloadDir: string) =>
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

const buildPlatformArtifact = (context: Context, platform: ReleasePlatform) =>
  Effect.gen(function* () {
    const payloadDir = payloadDirFor(context, platform);
    yield* context.fs.remove(workDirFor(context, platform), { force: true, recursive: true });
    yield* context.fs.makeDirectory(payloadDir, { recursive: true });
    yield* Console.log(`==> compiling ${platform.name} (${platform.bunTarget})`);
    yield* runInherit({
      args: [
        "build",
        "--compile",
        "--no-compile-autoload-bunfig",
        "--no-compile-autoload-dotenv",
        `--target=${platform.bunTarget}`,
        "./dist/bun/cli.js",
        "./src/utils/image-resize-worker.ts",
        "./src/extensions/codemode/worker.ts",
        `--outfile=${context.path.join(payloadDir, platform.executable)}`,
      ],
      command: "bun",
      cwd: context.codingAgentDir,
    });
    yield* copyPayload(context, platform, payloadDir);
    const archivePath = archivePathFor(context, platform);
    yield* context.fs.remove(archivePath, { force: true });
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
    const crypto = yield* Crypto.Crypto;
    const lines: string[] = [];
    for (const platform of context.platforms) {
      const archivePath = archivePathFor(context, platform);
      const digest = yield* crypto.digest("SHA-256", yield* context.fs.readFile(archivePath));
      lines.push(`${Hex.encode(digest)}  ${context.path.basename(archivePath)}`);
    }
    yield* context.fs.writeFileString(
      context.path.join(context.outDir, "SHA256SUMS"),
      `${lines.join("\n")}\n`,
    );
  });

const versionMatches = (expected: string, exitCode: number, reported: string) =>
  exitCode === 0 && reported === expected;

const smokeTest = (context: Context) =>
  Effect.gen(function* () {
    const host = hostPlatformName();
    const platform = context.platforms.find((candidate) => candidate.name === host);
    if (platform === undefined) {
      yield* Console.log(`==> skipping the smoke test: no ${host ?? "host"} archive in this run`);
      return;
    }
    const smokeDir = context.path.join(context.outDir, "smoke");
    yield* context.fs.remove(smokeDir, { force: true, recursive: true });
    yield* context.fs.makeDirectory(smokeDir, { recursive: true });
    yield* runInherit({
      args: [ARCHIVE_FLAGS[platform.archive], archivePathFor(context, platform), "-C", smokeDir],
      command: "tar",
      cwd: context.repoRoot,
    });
    const binary = context.path.join(smokeDir, archiveRootFor(platform), platform.executable);
    const { exitCode, stderr, stdout } = yield* captureProcess({
      args: ["--version"],
      command: binary,
      cwd: smokeDir,
    });
    const reported = stdout.trim();
    if (versionMatches(context.version, exitCode, reported)) {
      yield* Console.log(`==> ${platform.name} archive runs: msa --version reports ${reported}`);
      return;
    }
    return yield* new BuildBinariesError({
      message: `${platform.name} reported "${reported}" (exit ${exitCode}), expected ${context.version}:\n${stderr}`,
    });
  });

const program = Effect.gen(function* () {
  const unknown = unknownArguments();
  if (unknown.length > 0) {
    return yield* new BuildBinariesError({ message: `unknown argument(s): ${unknown.join(", ")}` });
  }
  const context = yield* makeContext();
  yield* Console.log(
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
  yield* Console.log(
    [
      `==> release assets in ${context.path.relative(context.repoRoot, context.outDir)}:`,
      ...rows,
      "    SHA256SUMS",
    ].join("\n"),
  );
});

const mainLayer = Layer.mergeAll(NodeServices.layer, processRunnerLayer, workspaceLayer);

runMainWith(program, mainLayer);
