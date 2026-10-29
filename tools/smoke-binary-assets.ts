import { Effect, Schema } from "effect";
import { build } from "esbuild";

import scriptOutput from "../libs/ai/src/utils/script-output.ts";
import type scriptOutputTypes from "../libs/ai/src/utils/script-output.types.ts";
import captureProcessModule from "./capture-process.ts";
import hiddenBuildTree from "./hidden-build-tree.ts";
import type hiddenBuildTreeTypes from "./hidden-build-tree.types.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { runMainWith, ScriptOutput } = scriptOutput;
const { binaryRunner } = hiddenBuildTree;

const CODING_AGENT = ["apps", "coding-agent"];
const NODE_CLI = [...CODING_AGENT, "dist", "bundle", "cli.js"];
const IMAGE_FIXTURE = ["libs", "ai", "test", "data", "red-circle.png"];
const SESSION_FIXTURE = [...CODING_AGENT, "test", "fixtures", "before-compaction.jsonl"];
const SESSION = "session.jsonl";
const PROBE_IMAGE = "probe.png";
const PROBE_RESULT_FILE = "assets-probe.json";
const SKIPPED_ENTRIES = new Set(["node_modules", ".DS_Store"]);
const PROBE_BUNDLE = "assets-probe.js";
class AssetsSmokeError extends Schema.TaggedError<
  AssetsSmokeError,
  { readonly brand: unique symbol }
>()("AssetsSmokeError", { message: Schema.String }) {}

const ProbeResult = Schema.fromJsonString(
  Schema.Struct({
    changelog: Schema.Array(Schema.Unknown),
    codemode: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
    docs: Schema.String,
    examples: Schema.String,
    nativeClipboard: Schema.Record(Schema.String, Schema.Unknown),
    readme: Schema.String,
    resized: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
    resizedInWorker: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
    themes: Schema.Array(Schema.Unknown),
    version: Schema.String,
  }),
);

type Probed = typeof ProbeResult.Type;

type Runner = hiddenBuildTreeTypes.Runner;

const runProbe = (workDir: string, runner: Runner) =>
  Effect.gen(function* () {
    const output = yield* ScriptOutput;
    const { files: fs, path } = output;
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const runDir = path.join(workDir, runner.name);
    const agentDir = path.join(runDir, "agent");
    yield* fs.makeDirectory(agentDir);
    yield* output.copyFileTo(path.join(repoRoot, ...IMAGE_FIXTURE), path.join(runDir, PROBE_IMAGE));
    const { exitCode, stderr, stdout } = yield* captureProcess({
      args: [
        ...runner.args,
        "-e",
        path.join(workDir, PROBE_BUNDLE),
        "--model",
        "probe/scripted",
        "-p",
        "assets-probe",
      ],
      command: runner.command,
      cwd: runDir,
      env: { MSA_CODING_AGENT_DIR: agentDir },
    });
    const raw = yield* fs.readText(path.join(runDir, PROBE_RESULT_FILE)).pipe(
      Effect.mapError(() =>
        AssetsSmokeError.make({
          message: `${runner.name} exited ${exitCode} without a probe result:\n${stdout}${stderr}`,
        }),
      ),
    );
    return { probed: yield* Schema.decodeEffect(ProbeResult)(raw), raw };
  });

const exportHtml = (workDir: string, runner: Runner) =>
  Effect.gen(function* () {
    const { files: fs, path } = yield* ScriptOutput;
    const runDir = path.join(workDir, runner.name);
    const outputPath = path.join(runDir, "export.html");
    const { exitCode, stderr, stdout } = yield* captureProcess({
      args: [...runner.args, "--export", path.join(workDir, SESSION), outputPath],
      command: runner.command,
      cwd: runDir,
      env: { MSA_CODING_AGENT_DIR: path.join(runDir, "agent") },
    });
    if (exitCode !== 0) {
      return yield* AssetsSmokeError.make({
        message: `${runner.name} --export exited with ${exitCode}:\n${stdout}${stderr}`,
      });
    }
    return yield* fs.readBytes(outputPath);
  });

const readTree: (
  root: string,
  relative: string,
) => Effect.Effect<
  ReadonlyArray<readonly [string, Uint8Array]>,
  AssetsSmokeError,
  scriptOutputTypes.ScriptOutput
> = (root, relative) =>
  Effect.gen(function* () {
    const { files: fs, path } = yield* ScriptOutput;
    const absolute = path.join(root, relative);
    const info = yield* fs.stat(absolute);
    if (!info.isDirectory) return [[relative, yield* fs.readBytes(absolute)]] as const;
    const entries = yield* fs.readDirectory(absolute);
    const nested = yield* Effect.forEach(
      entries.filter((entry) => !SKIPPED_ENTRIES.has(entry)).toSorted(),
      (entry) => readTree(root, path.join(relative, entry)),
    );
    return nested.flat();
  }).pipe(
    Effect.mapError((cause) =>
      AssetsSmokeError.make({ message: `cannot read ${root}/${relative}: ${String(cause)}` }),
    ),
  );

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

const compareTree = (label: string, fromBinary: string, fromNode: string) =>
  Effect.gen(function* () {
    const { path } = yield* ScriptOutput;
    const binaryFiles = yield* readTree(path.dirname(fromBinary), path.basename(fromBinary));
    const nodeFiles = new Map(yield* readTree(path.dirname(fromNode), path.basename(fromNode)));
    const binaryNames = binaryFiles.map(([name]) => name);
    const missing = [...nodeFiles.keys()].filter((name) => !binaryNames.includes(name));
    const differing = binaryFiles.filter(([name, bytes]) => {
      const expected = nodeFiles.get(name);
      return expected === undefined || !sameBytes(bytes, expected);
    });
    if (missing.length > 0 || differing.length > 0) {
      return yield* AssetsSmokeError.make({
        message: `${label} at ${fromBinary} differs from ${fromNode}: missing [${missing.join(", ")}], differing [${differing.map(([name]) => name).join(", ")}]`,
      });
    }
    return binaryFiles.length;
  });

const compareProbed = (
  key:
    | "changelog"
    | "codemode"
    | "nativeClipboard"
    | "resized"
    | "resizedInWorker"
    | "themes"
    | "version",
  fromBinary: Probed,
  fromNode: Probed,
) =>
  Effect.gen(function* () {
    const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
    const binaryValue = yield* encode(fromBinary[key]);
    const nodeValue = yield* encode(fromNode[key]);
    if (binaryValue !== nodeValue) {
      return yield* AssetsSmokeError.make({
        message: `the binary's ${key} differs from node's:\n  binary: ${binaryValue.slice(0, 400)}\n  node:   ${nodeValue.slice(0, 400)}`,
      });
    }
  });

const bundleProbe = (workDir: string) =>
  Effect.gen(function* () {
    const { path } = yield* ScriptOutput;
    yield* Effect.tryPromise({
      catch: (cause) =>
        AssetsSmokeError.make({ message: `cannot bundle the probe: ${String(cause)}` }),
      try: () =>
        build({
          bundle: true,
          entryPoints: [path.join(import.meta.dirname, "binary-smoke", "assets-probe.ts")],
          external: ["@msa/*"],
          format: "esm",
          logLevel: "silent",
          outfile: path.join(workDir, PROBE_BUNDLE),
          platform: "node",
        }),
    });
  });

const CODEMODE_EXPECTED = '[42,"undefined"]';

const NODE_EXERCISES: ReadonlyArray<readonly [string, (node: Probed) => boolean]> = [
  ["node did not resize the probe image", (node) => node.resized?.["wasResized"] === true],
  [
    "node's image-resize worker did not resize the probe image",
    (node) => node.resizedInWorker?.["wasResized"] === true,
  ],
  ["node parsed no CHANGELOG entries", (node) => node.changelog.length > 0],
  [
    "node did not load and call the native clipboard helper (on Linux, run under an X server such as xvfb-run)",
    (node) =>
      node.nativeClipboard["loaded"] === true &&
      !String(node.nativeClipboard["text"]).startsWith("failed"),
  ],
  [
    "node's codemode worker did not run the probe script",
    (node) => node.codemode?.["isError"] === false && node.codemode["output"] === CODEMODE_EXPECTED,
  ],
];

const nodeGap = (node: Probed): string | undefined =>
  NODE_EXERCISES.find(([, exercised]) => !exercised(node))?.[0];

const checkNodeExercised = (node: { readonly probed: Probed; readonly raw: string }) => {
  const gap = nodeGap(node.probed);
  return gap === undefined
    ? Effect.void
    : AssetsSmokeError.make({ message: `${gap}: ${node.raw.slice(0, 600)}` });
};

const compareHtml = (fromBinary: Uint8Array, fromNode: Uint8Array) =>
  sameBytes(fromBinary, fromNode)
    ? Effect.succeed(fromBinary.length)
    : AssetsSmokeError.make({
        message: `the binary's --export wrote ${fromBinary.length} bytes of HTML that differ from the ${fromNode.length} bytes node wrote`,
      });

const compareAll = (fromBinary: Probed, fromNode: Probed) =>
  Effect.gen(function* () {
    for (const key of [
      "version",
      "themes",
      "changelog",
      "resized",
      "resizedInWorker",
      "codemode",
      "nativeClipboard",
    ] as const) {
      yield* compareProbed(key, fromBinary, fromNode);
    }
    let files = 0;
    for (const key of ["readme", "docs", "examples"] as const) {
      files += yield* compareTree(key, fromBinary[key], fromNode[key]);
    }
    return files;
  });

const assetsSmoke = (binaryArgument: string) =>
  Effect.gen(function* () {
    const output = yield* ScriptOutput;
    const { files: fs, path } = output;
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const workDir = yield* fs.makeTempDirectoryScoped("msa-assets-smoke-");
    yield* bundleProbe(workDir);
    yield* output.copyFileTo(path.join(repoRoot, ...SESSION_FIXTURE), path.join(workDir, SESSION));
    const payloadDir = path.join(workDir, "payload");
    yield* output.copyTreeTo(path.dirname(path.resolve(binaryArgument)), payloadDir);
    const binaryRun = yield* binaryRunner(
      path.join(payloadDir, path.basename(binaryArgument)),
      repoRoot,
      workDir,
    );
    const nodeRun: Runner = {
      args: [path.join(repoRoot, ...NODE_CLI)],
      command: "node",
      name: "node",
    };
    const binary = yield* runProbe(workDir, binaryRun);
    const node = yield* runProbe(workDir, nodeRun);
    yield* checkNodeExercised(node);
    const html = yield* compareHtml(
      yield* exportHtml(workDir, binaryRun),
      yield* exportHtml(workDir, nodeRun),
    );
    return {
      changelog: node.probed.changelog.length,
      files: yield* compareAll(binary.probed, node.probed),
      html,
      themes: node.probed.themes.length,
    };
  }).pipe(Effect.scoped);

const program = Effect.gen(function* () {
  const [binary, ...rest] = process.argv.slice(2);
  if (binary === undefined || rest.length > 0) {
    return yield* AssetsSmokeError.make({ message: "usage: smoke-binary-assets <msa binary>" });
  }
  const { changelog, files, html, themes } = yield* assetsSmoke(binary);
  yield* scriptOutput.print(
    `==> ${binary} matches node: version, ${themes} themes, ${changelog} CHANGELOG entries, the photon resize in the image-resize worker, a codemode script in the codemode worker, the native clipboard helper, ${html} bytes of --export HTML, and ${files} README/docs/examples files read from outside the process`,
  );
});

runMainWith(program, processRunnerLayer);
