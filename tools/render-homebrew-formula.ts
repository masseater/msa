import { parseArgs } from "node:util";

import { NodeServices } from "@effect/platform-node";
import { Console, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import { Workspace, workspaceLayer } from "./coding-agent-package.ts";
import { RELEASE_PLATFORMS, archiveFileNameFor } from "./release-platforms.ts";
import { runMainWith } from "./run-main.ts";

const DEFAULT_SUMS = [".artifacts", "binaries", "SHA256SUMS"];
const DEFAULT_OUT = [".artifacts", "homebrew", "msa.rb"];
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const SUMS_LINE_PATTERN = /^([0-9a-f]{64}) {2}(\S+)$/u;
const HOMEPAGE = "https://github.com/masseater/msa";
const PLATFORM_NAMES = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] as const;

class RenderHomebrewFormulaError extends Data.TaggedError("RenderHomebrewFormulaError")<{
  readonly message: string;
}> {}

const packageJsonJson = Schema.fromJsonString(
  Schema.Struct({
    description: Schema.String,
    license: Schema.String,
  }),
);

type Flags = Readonly<{ out?: string; sums?: string; version?: string }>;

const parseFlags = () =>
  Effect.try({
    catch: (error) =>
      new RenderHomebrewFormulaError({
        message: `usage: render-homebrew-formula.ts [--version <x.y.z>] [--sums <SHA256SUMS>] [--out <path>] (${String(error)})`,
      }),
    try: (): Flags =>
      parseArgs({
        options: {
          out: { type: "string" },
          sums: { type: "string" },
          version: { type: "string" },
        },
      }).values,
  });

const requireVersion = (candidate: string) =>
  VERSION_PATTERN.test(candidate)
    ? Effect.succeed(candidate)
    : Effect.fail(new RenderHomebrewFormulaError({ message: `invalid version: ${candidate}` }));

const requireShortDescription = (description: string) =>
  description.length >= 80
    ? Effect.fail(
        new RenderHomebrewFormulaError({
          message: `package description must be shorter than 80 characters for Homebrew: ${description}`,
        }),
      )
    : Effect.succeed(description);

const makeContext = (flags: Flags) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace;
    const {
      packageJsonText,
      repoRoot,
      version: packageVersion,
    } = yield* workspace.loadCodingAgentPackage;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { description, license } = yield* Schema.decodeEffect(packageJsonJson)(packageJsonText);
    const version = yield* requireVersion(flags.version ?? packageVersion);
    const shortDescription = yield* requireShortDescription(description);
    return {
      description: shortDescription,
      fs,
      license,
      outPath: path.resolve(repoRoot, flags.out ?? path.join(...DEFAULT_OUT)),
      path,
      repoRoot,
      sumsPath: path.resolve(repoRoot, flags.sums ?? path.join(...DEFAULT_SUMS)),
      version,
    };
  });

type Context = Effect.Success<ReturnType<typeof makeContext>>;

const parseChecksumLine = (line: string): readonly [string, string] | undefined => {
  const match = SUMS_LINE_PATTERN.exec(line);
  if (match === null) {
    return undefined;
  }
  const [, hash, name] = match;
  return hash === undefined || name === undefined ? undefined : [name, hash];
};

const readChecksums = (context: Context) =>
  Effect.gen(function* () {
    const lines = (yield* context.fs.readFileString(context.sumsPath))
      .split("\n")
      .filter((line) => line !== "");
    const linesWithEntries = lines.map((line) => ({ entry: parseChecksumLine(line), line }));
    const malformed = linesWithEntries.find(({ entry }) => entry === undefined);
    if (malformed !== undefined) {
      return yield* new RenderHomebrewFormulaError({
        message: `malformed checksum line in ${context.sumsPath}: ${malformed.line}`,
      });
    }
    return new Map(linesWithEntries.flatMap(({ entry }) => (entry === undefined ? [] : [entry])));
  });
type Checksums = Effect.Success<ReturnType<typeof readChecksums>>;

const targetFor = (platformName: string): Readonly<{ cpu: string; os: string }> => ({
  cpu: platformName.includes("arm64") ? "on_arm" : "on_intel",
  os: platformName.startsWith("darwin") ? "on_macos" : "on_linux",
});

const checksumFor = (context: Context, checksums: Checksums, platformName: string) =>
  Effect.gen(function* () {
    const platform = RELEASE_PLATFORMS.find((candidate) => candidate.name === platformName);
    if (platform === undefined) {
      return yield* new RenderHomebrewFormulaError({
        message: `unknown platform: ${platformName}`,
      });
    }
    const archive = archiveFileNameFor(platform);
    const sha256 = checksums.get(archive);
    if (sha256 === undefined) {
      return yield* new RenderHomebrewFormulaError({
        message: `no checksum for ${archive} in ${context.sumsPath}`,
      });
    }
    return {
      ...targetFor(platformName),
      sha256,
      url: `${HOMEPAGE}/releases/download/v${context.version}/${archive}`,
    };
  });

const renderCpuBlock = (entry: Effect.Success<ReturnType<typeof checksumFor>>) =>
  [
    `    ${entry.cpu} do`,
    `      url ${JSON.stringify(entry.url)}`,
    `      sha256 ${JSON.stringify(entry.sha256)}`,
    "    end",
  ].join("\n");

const renderOsBlock = (
  os: string,
  entries: ReadonlyArray<Effect.Success<ReturnType<typeof checksumFor>>>,
) => [`  ${os} do`, entries.map((entry) => renderCpuBlock(entry)).join("\n\n"), "  end"].join("\n");

const renderFormula = (
  context: Context,
  entries: ReadonlyArray<Effect.Success<ReturnType<typeof checksumFor>>>,
) =>
  [
    "# This file is generated by tools/render-homebrew-formula.ts in masseater/msa. Do not edit by hand.",
    "class Msa < Formula",
    `  desc ${JSON.stringify(context.description)}`,
    `  homepage ${JSON.stringify(HOMEPAGE)}`,
    `  license ${JSON.stringify(context.license)}`,
    "",
    renderOsBlock(
      "on_macos",
      entries.filter((entry) => entry.os === "on_macos"),
    ),
    "",
    renderOsBlock(
      "on_linux",
      entries.filter((entry) => entry.os === "on_linux"),
    ),
    "",
    "  def install",
    '    libexec.install Dir["*"] - ["README.md", "CHANGELOG.md"]',
    '    bin.install_symlink libexec/"msa"',
    "  end",
    "",
    "  test do",
    '    assert_match version.to_s, shell_output("#{bin}/msa --version")',
    "  end",
    "end",
    "",
  ].join("\n");

const program = Effect.gen(function* () {
  const context = yield* makeContext(yield* parseFlags());
  const checksums = yield* readChecksums(context);
  const entries = [];
  for (const platformName of PLATFORM_NAMES) {
    entries.push(yield* checksumFor(context, checksums, platformName));
  }
  yield* context.fs.makeDirectory(context.path.dirname(context.outPath), { recursive: true });
  yield* context.fs.writeFileString(context.outPath, renderFormula(context, entries));
  yield* Console.log(
    `==> wrote ${context.path.relative(context.repoRoot, context.outPath)} for msa ${context.version}`,
  );
});

const mainLayer = Layer.mergeAll(NodeServices.layer, workspaceLayer);

runMainWith(program, mainLayer);
