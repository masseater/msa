import { NodeServices } from "@effect/platform-node";
import { Console, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import captureProcessModule from "./capture-process.ts";
import runMain from "./run-main.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { runMainWith } = runMain;

const PROBE_RESULT_FILE = "decide-probe.json";
const PROBE_PROMPT = "decide-probe: create the probe task";
const PROBE_SETTINGS = { decision: { model: "local/decide-probe" } };
const DECIDED = /^Review verdict: fail \(local\/decide-probe: /u;

class DecideSmokeError extends Data.TaggedError("DecideSmokeError")<{
  readonly message: string;
}> {}

const ProbeResult = Schema.fromJsonString(Schema.Struct({ verdict: Schema.String }));

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
        "-e",
        path.join(import.meta.dirname, "binary-smoke", "decide-probe.ts"),
        "--model",
        "probe/scripted",
        "-p",
        PROBE_PROMPT,
      ],
      command: binary,
      cwd: workDir,
      env: { MSA_CODING_AGENT_DIR: agentDir },
    });
    const raw = yield* fs.readFileString(path.join(workDir, PROBE_RESULT_FILE)).pipe(
      Effect.mapError(
        () =>
          new DecideSmokeError({
            message: `${binary} exited ${exitCode} without a review verdict:\n${stderr}`,
          }),
      ),
    );
    const { verdict } = yield* Schema.decodeEffect(ProbeResult)(raw);
    if (!DECIDED.test(verdict))
      return yield* new DecideSmokeError({
        message: `${binary} did not fail the review with the fixture decision model: ${verdict}\n${stderr}`,
      });
    return verdict;
  }).pipe(Effect.scoped, Effect.orDie);

const program = Effect.gen(function* () {
  const [binary, ...rest] = process.argv.slice(2);
  if (binary === undefined || rest.length > 0) {
    return yield* new DecideSmokeError({ message: "usage: smoke-binary-decide <msa binary>" });
  }
  const verdict = yield* decideSmoke(binary);
  yield* Console.log(`==> ${binary} decides a task review through node-llama-cpp: ${verdict}`);
});

runMainWith(program, Layer.mergeAll(NodeServices.layer, processRunnerLayer));
