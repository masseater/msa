import { NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import { serve } from "srvx";

import captureProcessModule from "./capture-process.ts";
import runMain from "./run-main.ts";

const { captureProcess, processRunnerLayer } = captureProcessModule;
const { runMainWith } = runMain;

const PROBE_RESULT_FILE = "decide-probe.json";
const PROBE_PROMPT = "decide-probe: create the probe task";
const PROBE_SETTINGS = { decision: { model: "local/decide-probe" } };
const DECIDED = /^Review verdict: fail \(local\/decide-probe: /u;

class DecideSmokeError extends Schema.TaggedError<
  DecideSmokeError,
  { readonly brand: unique symbol }
>()("DecideSmokeError", { message: Schema.String }) {}

const ProbeResult = Schema.fromJsonString(Schema.Struct({ verdict: Schema.String }));

const otlpReceiver = Effect.gen(function* () {
  const exports = yield* Ref.make(0);
  const counted = Effect.runSyncWith(yield* Effect.context<never>());
  const server = yield* Effect.acquireRelease(
    Effect.promise(() => {
      const started = serve({
        fetch: () => {
          counted(Ref.update(exports, (count) => count + 1));
          return new Response(null, { status: 200 });
        },
        gracefulShutdown: false,
        hostname: "127.0.0.1",
        manual: true,
        port: 0,
        silent: true,
      });
      return Promise.resolve(started.serve()).then(() => started.ready());
    }),
    (started) => Effect.promise(() => started.close(true)),
  );
  if (server.url === undefined)
    return yield* DecideSmokeError.make({ message: "the OTLP receiver did not bind to TCP" });
  return { endpoint: new URL(server.url).origin, exports };
});

const decideSmoke = (binaryArgument: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binary = path.resolve(binaryArgument);
    const workDir = yield* fs.makeTempDirectoryScoped({ prefix: "msa-decide-smoke-" });
    const agentDir = path.join(workDir, "agent");
    yield* fs.makeDirectory(agentDir, { recursive: true });
    yield* fs.writeFileString(
      path.join(agentDir, "settings.json"),
      yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(PROBE_SETTINGS),
    );
    const receiver = yield* otlpReceiver;
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
      env: { MSA_CODING_AGENT_DIR: agentDir, MSA_OTLP_ENDPOINT: receiver.endpoint },
    });
    const raw = yield* fs.readFileString(path.join(workDir, PROBE_RESULT_FILE)).pipe(
      Effect.mapError(() =>
        DecideSmokeError.make({
          message: `${binary} exited ${exitCode} without a review verdict:\n${stderr}`,
        }),
      ),
    );
    const { verdict } = yield* Schema.decodeEffect(ProbeResult)(raw);
    if (!DECIDED.test(verdict))
      return yield* DecideSmokeError.make({
        message: `${binary} did not fail the review with the fixture decision model: ${verdict}\n${stderr}`,
      });
    if ((yield* Ref.get(receiver.exports)) === 0)
      return yield* DecideSmokeError.make({
        message: `${binary} sent no telemetry to the smoke's OTLP receiver ${receiver.endpoint}:\n${stderr}`,
      });
    return verdict;
  }).pipe(Effect.scoped, Effect.orDie);

const program = Effect.gen(function* () {
  const [binary, ...rest] = process.argv.slice(2);
  if (binary === undefined || rest.length > 0) {
    return yield* DecideSmokeError.make({ message: "usage: smoke-binary-decide <msa binary>" });
  }
  const verdict = yield* decideSmoke(binary);
  yield* Console.log(`==> ${binary} decides a task review through node-llama-cpp: ${verdict}`);
});

runMainWith(program, Layer.mergeAll(NodeServices.layer, processRunnerLayer));
