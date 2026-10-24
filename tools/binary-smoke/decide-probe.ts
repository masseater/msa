import { NodeServices } from "@effect/platform-node";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, FileSystem, ManagedRuntime, Path, Schedule, Schema } from "effect";

const PROBE_MODEL = { id: "decide-probe", provider: "local" } as const;
const PROBE_RESULT_FILE = "decide-probe.json";
const FIXTURE = ["..", "..", "libs", "ai", "test", "fixtures", "stories260K.gguf"];

const runtime = ManagedRuntime.make(NodeServices.layer);

const context = {
  questions: {
    route: {
      criteria: { billing: "money", technical: "code" },
      instructions: "Which team should answer?",
      type: "choice",
    },
  },
  state: { ticket: "The build fails after the upgrade." },
} as const;

const classifyProbe = (ctx: codingAgentTypes.ExtensionContext) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const model = ctx.modelRegistry.getModelOfType(
      "classifier",
      PROBE_MODEL.provider,
      PROBE_MODEL.id,
    );
    const result =
      model === undefined
        ? { errorMessage: "probe classifier is not registered", stopReason: "error" }
        : yield* Effect.promise(() => ctx.modelRegistry.classify(model, context)).pipe(
            Effect.repeat({
              schedule: Schedule.spaced("500 millis"),
              times: 120,
              until: (classified) => classified.stopReason === "stop",
            }),
          );
    yield* fs.writeFileString(
      path.join(ctx.cwd, PROBE_RESULT_FILE),
      yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(result),
    );
  });

const decideProbe = (msa: codingAgentTypes.ExtensionAPI) => {
  const fixture = runtime.runSync(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      return path.join(import.meta.dirname, ...FIXTURE);
    }),
  );
  msa.registerProvider(PROBE_MODEL.provider, {
    models: [
      {
        api: "node-llama-cpp-classify",
        baseUrl: fixture,
        contextWindow: 4096,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: PROBE_MODEL.id,
        input: ["text"],
        name: "Decide probe",
        type: "classifier",
      },
    ],
  });
  let probe: Promise<void> | undefined;
  msa.on("session_start", (_event, ctx) => {
    probe = runtime.runPromise(classifyProbe(ctx));
  });
  msa.on("session_shutdown", () => probe);
};

export default decideProbe;
