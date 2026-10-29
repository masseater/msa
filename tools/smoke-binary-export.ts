import { NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Layer, Path, Schema } from "effect";

import captureProcessModule from "./capture-process.ts";
import runMain from "./run-main.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { runMainWith } = runMain;

const CODING_AGENT = ["apps", "coding-agent"];
const SESSION_FIXTURE = [...CODING_AGENT, "test", "fixtures", "before-compaction.jsonl"];
const NODE_CLI = [...CODING_AGENT, "dist", "bundle", "cli.js"];

class ExportSmokeError extends Schema.TaggedError<
  ExportSmokeError,
  { readonly brand: unique symbol }
>()("ExportSmokeError", { message: Schema.String }) {}

interface Runner {
  readonly args: ReadonlyArray<string>;
  readonly command: string;
}

const exportHtml = (workDir: string, sessionPath: string, runner: Runner, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const outputPath = path.join(workDir, `${name}.html`);
    const { exitCode, stderr, stdout } = yield* captureProcess({
      args: [...runner.args, "--export", sessionPath, outputPath],
      command: runner.command,
      cwd: workDir,
      env: { MSA_CODING_AGENT_DIR: path.join(workDir, "agent") },
    });
    if (exitCode !== 0) {
      return yield* ExportSmokeError.make({
        message: `${runner.command} --export exited with ${exitCode}:\n${stdout}${stderr}`,
      });
    }
    return yield* fs.readFile(outputPath);
  });

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

const exportSmoke = (binaryArgument: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const binary = path.resolve(binaryArgument);
    const workDir = yield* fs.makeTempDirectoryScoped({ prefix: "msa-export-smoke-" });
    const sessionPath = path.join(workDir, "session.jsonl");
    yield* fs.copyFile(path.join(repoRoot, ...SESSION_FIXTURE), sessionPath);
    const fromBinary = yield* exportHtml(
      workDir,
      sessionPath,
      { args: [], command: binary },
      "bin",
    );
    const fromNode = yield* exportHtml(
      workDir,
      sessionPath,
      { args: [path.join(repoRoot, ...NODE_CLI)], command: "node" },
      "node",
    );
    if (!sameBytes(fromBinary, fromNode)) {
      return yield* ExportSmokeError.make({
        message: `${binary} --export wrote ${fromBinary.length} bytes of HTML that differ from the ${fromNode.length} bytes node wrote`,
      });
    }
    return fromBinary.length;
  }).pipe(Effect.scoped);

const program = Effect.gen(function* () {
  const [binary, ...rest] = process.argv.slice(2);
  if (binary === undefined || rest.length > 0) {
    return yield* ExportSmokeError.make({ message: "usage: smoke-binary-export <msa binary>" });
  }
  const bytes = yield* exportSmoke(binary);
  yield* Console.log(`==> ${binary} --export writes the same ${bytes} bytes of HTML as node`);
});

runMainWith(program, Layer.mergeAll(NodeServices.layer, processRunnerLayer));
