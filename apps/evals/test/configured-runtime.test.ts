import { Effect, Schema } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createAcmeServer,
  OPENAI_MODEL_ID,
  OPENAI_PROBE_PROMPT,
  OPENAI_PROBE_RESPONSE,
  OPENAI_PROVIDER_ID,
} from "../evals/acme-server.ts";
import {
  inspectAddedModel,
  inspectProvider,
  loadConfiguredModelRuntime,
} from "../evals/configured-runtime.ts";
import { files, pathOperations } from "../src/platform.ts";

const PROVIDER_ID = OPENAI_PROVIDER_ID;
const MODEL = {
  id: OPENAI_MODEL_ID,
  name: "Acme Chat",
  provider: PROVIDER_ID,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 4096,
};
const server = createAcmeServer("openai");
const temporaryDirectories: string[] = [];
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

afterEach(() =>
  Effect.runPromise(
    Effect.forEach(temporaryDirectories.splice(0), files.remove, { discard: true }),
  ),
);
beforeAll(() => Effect.runPromise(server.start));
beforeEach(() => server.reset());
afterAll(() => Effect.runPromise(server.stop));

const run = (effect: Effect.Effect<void>) => Effect.runPromise(effect);

const agentDirWithText = (modelsJson: string) =>
  Effect.gen(function* () {
    const directory = yield* files.makeTempDirectory("msa-eval-provider-probe-");
    temporaryDirectories.push(directory);
    yield* files.writeFileString(pathOperations.join(directory, "models.json"), modelsJson);
    return directory;
  });

const agentDirWith = (modelsJson: unknown) =>
  Effect.flatMap(Effect.orDie(encodeJson(modelsJson)), (text) => agentDirWithText(`${text}\n`));

const runtimeWith = (modelsJson: unknown) =>
  Effect.flatMap(agentDirWith(modelsJson), loadConfiguredModelRuntime);

const modelEntry = (model: {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: unknown;
  contextWindow: number;
  maxTokens: number;
}) => ({
  id: model.id,
  name: model.name,
  reasoning: model.reasoning,
  input: model.input,
  cost: model.cost,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
});

const acmeModelsJson = () => ({
  providers: {
    [PROVIDER_ID]: {
      baseUrl: server.baseUrl(),
      api: "openai-completions",
      apiKey: "$ACME_API_KEY",
      models: [modelEntry(MODEL)],
    },
  },
});

function probe(content: string, apiKey: string) {
  return {
    providerId: PROVIDER_ID,
    modelId: OPENAI_MODEL_ID,
    createContext: () => ({
      messages: [{ role: "user" as const, content, timestamp: 0 }],
    }),
    options: { env: { ACME_API_KEY: apiKey }, maxTokens: 32 },
    validRequestReceived: server.validRequestReceived,
  };
}

const probedResponse = {
  text: OPENAI_PROBE_RESPONSE,
  stopReason: "stop",
  inputTokens: 3,
  outputTokens: 2,
};

describe("inspectProvider probing", () => {
  it("probes a models.json provider through ModelRuntime", () =>
    run(
      Effect.gen(function* () {
        const runtime = yield* runtimeWith(acmeModelsJson());
        const output = yield* inspectProvider(
          runtime,
          probe(OPENAI_PROBE_PROMPT, "resolved-acme-key"),
        );
        expect(output).toEqual({
          result: { validRequestReceived: true, model: MODEL, response: probedResponse },
        });
      }),
    ));

  it("keeps a non-probe completion distinct from a valid probe", () =>
    run(
      Effect.gen(function* () {
        const runtime = yield* runtimeWith(acmeModelsJson());
        const output = yield* inspectProvider(runtime, probe("hello", "resolved-acme-key"));
        expect(output).toEqual({
          result: { validRequestReceived: false, model: MODEL, response: probedResponse },
        });
      }),
    ));

  it("does not treat an unauthorized completion as a valid probe", () =>
    run(
      Effect.gen(function* () {
        const runtime = yield* runtimeWith(acmeModelsJson());
        const output = yield* inspectProvider(runtime, probe(OPENAI_PROBE_PROMPT, "wrong-key"));
        expect(output).toEqual({
          result: {
            validRequestReceived: false,
            model: MODEL,
            response: { text: "", stopReason: "error", inputTokens: 0, outputTokens: 0 },
          },
        });
      }),
    ));
});

describe("inspectProvider failures", () => {
  it("returns a structured error when the configured model is missing", () =>
    run(
      Effect.gen(function* () {
        const runtime = yield* runtimeWith({ providers: {} });
        const output = yield* inspectProvider(
          runtime,
          probe(OPENAI_PROBE_PROMPT, "resolved-acme-key"),
        );
        expect(output).toEqual({
          result: {
            error: `Model ${PROVIDER_ID}/${OPENAI_MODEL_ID} is unavailable after reload.`,
          },
        });
        expect(server.validRequestReceived()).toBe(false);
      }),
    ));

  it("returns a structured error when models.json cannot be parsed", () =>
    run(
      Effect.gen(function* () {
        const runtime = yield* loadConfiguredModelRuntime(yield* agentDirWithText("{"));
        const output = yield* inspectProvider(
          runtime,
          probe(OPENAI_PROBE_PROMPT, "resolved-acme-key"),
        );
        expect(output).toEqual({
          result: { error: expect.stringContaining("Failed to parse models.json") },
        });
        expect(server.validRequestReceived()).toBe(false);
      }),
    ));
});

const ADDED_PROVIDER = "openai";
const ADDED_MODEL_ID = "fixture-chat";
const ADDED_MODEL = {
  id: ADDED_MODEL_ID,
  name: "Fixture Chat",
  provider: ADDED_PROVIDER,
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 4096,
};

describe("inspectAddedModel", () => {
  it("loads an added model without dropping built-in models", () =>
    run(
      Effect.gen(function* () {
        const directory = yield* agentDirWith({
          providers: { [ADDED_PROVIDER]: { models: [modelEntry(ADDED_MODEL)] } },
        });
        const runtime = yield* loadConfiguredModelRuntime(directory);
        const output = yield* inspectAddedModel(runtime, ADDED_PROVIDER, ADDED_MODEL_ID);
        expect(output).toEqual({ result: { model: ADDED_MODEL, existingModelsPreserved: true } });
      }),
    ));

  it("returns a structured error when the added model is missing", () =>
    run(
      Effect.gen(function* () {
        const runtime = yield* runtimeWith({ providers: {} });
        const output = yield* inspectAddedModel(runtime, ADDED_PROVIDER, ADDED_MODEL_ID);
        expect(output).toEqual({
          result: {
            error: `Model ${ADDED_PROVIDER}/${ADDED_MODEL_ID} is unavailable after reload.`,
          },
        });
      }),
    ));

  it("returns a structured error when models.json cannot be parsed", () =>
    run(
      Effect.gen(function* () {
        const runtime = yield* loadConfiguredModelRuntime(yield* agentDirWithText("{"));
        const output = yield* inspectAddedModel(runtime, ADDED_PROVIDER, ADDED_MODEL_ID);
        expect(output).toEqual({
          result: { error: expect.stringContaining("Failed to parse models.json") },
        });
      }),
    ));
});
