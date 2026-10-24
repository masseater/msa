import { NodeServices } from "@effect/platform-node";
import { Console, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import captureProcessModule from "./capture-process.ts";
import runMain from "./run-main.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { runMainWith } = runMain;

const PROBE_RESULT_FILE = "decide-probe.json";
const PROBE_SETTINGS = { decision: { model: "local/decide-probe" } };

class DecideSmokeError extends Data.TaggedError("DecideSmokeError")<{
  readonly message: string;
}> {}

const AnsweredProbe = Schema.fromJsonString(
  Schema.Struct({
    answers: Schema.Record(Schema.String, Schema.Unknown),
    stopReason: Schema.Literal("stop"),
  }),
);

const decideSmoke = (binary: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workDir = yield* fs.makeTempDirectoryScoped({ prefix: "msa-decide-smoke-" });
    const agentDir = path.join(workDir, "agent");
    yield* fs.makeDirectory(agentDir, { recursive: true });
    yield* fs.writeFileString(
      path.join(agentDir, "settings.json"),
      yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(PROBE_SETTINGS),
    );
    const { exitCode, stderr } = yield* captureProcess({
      args: [
        "--mode",
        "rpc",
        "-e",
        path.join(import.meta.dirname, "binary-smoke", "decide-probe.ts"),
      ],
      command: binary,
      cwd: workDir,
      env: { MSA_CODING_AGENT_DIR: agentDir },
    });
    const raw = yield* fs.readFileString(path.join(workDir, PROBE_RESULT_FILE)).pipe(
      Effect.mapError(
        () =>
          new DecideSmokeError({
            message: `${binary} exited ${exitCode} without a decision probe result:\n${stderr}`,
          }),
      ),
    );
    yield* Schema.decodeEffect(AnsweredProbe)(raw).pipe(
      Effect.mapError(
        () =>
          new DecideSmokeError({
            message: `${binary} did not run the decision model: ${raw}\n${stderr}`,
          }),
      ),
    );
  }).pipe(Effect.scoped, Effect.orDie);

const program = Effect.gen(function* () {
  const [binary, ...rest] = process.argv.slice(2);
  if (binary === undefined || rest.length > 0) {
    return yield* new DecideSmokeError({ message: "usage: smoke-binary-decide <msa binary>" });
  }
  yield* decideSmoke(binary);
  yield* Console.log(`==> ${binary} runs the decision model through node-llama-cpp`);
});

runMainWith(program, Layer.mergeAll(NodeServices.layer, processRunnerLayer));
