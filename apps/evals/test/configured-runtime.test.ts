import { Effect, Schema } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import acmeServer from "../evals/acme-server.ts";
import configuredRuntime from "../evals/configured-runtime.ts";
import platform from "../src/platform.ts";

const {
  OPENAI_MODEL_ID,
  OPENAI_PROBE_PROMPT,
  OPENAI_PROBE_RESPONSE,
  OPENAI_PROVIDER_ID,
  createAcmeServer,
} = acmeServer;
const { files, pathOperations } = platform;
const { inspectAddedModel, inspectProvider, loadConfiguredModelRuntime } = configuredRuntime;

const PROVIDER_ID = OPENAI_PROVIDER_ID;
const MODEL = {
  contextWindow: 32768,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: OPENAI_MODEL_ID,
  input: ["text"],
  maxTokens: 4096,
  name: "Acme Chat",
  provider: PROVIDER_ID,
  reasoning: false,
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
  contextWindow: model.contextWindow,
  cost: model.cost,
  id: model.id,
  input: model.input,
  maxTokens: model.maxTokens,
  name: model.name,
  reasoning: model.reasoning,
});

const acmeModelsJson = () => ({
  providers: {
    [PROVIDER_ID]: {
      api: "openai-completions",
      apiKey: "$ACME_API_KEY",
      baseUrl: server.baseUrl(),
      models: [modelEntry(MODEL)],
    },
  },
});

function probe(content: string, apiKey: string) {
  return {
    createContext: () => ({
      messages: [{ content, role: "user" as const, timestamp: 0 }],
    }),
    modelId: OPENAI_MODEL_ID,
    options: { env: { ACME_API_KEY: apiKey }, maxTokens: 32 },
    providerId: PROVIDER_ID,
    validRequestReceived: server.validRequestReceived,
  };
}

const probedResponse = {
  inputTokens: 3,
  outputTokens: 2,
  stopReason: "stop",
  text: OPENAI_PROBE_RESPONSE,
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
          result: { model: MODEL, response: probedResponse, validRequestReceived: true },
        });
      }),
    ));

  it("keeps a non-probe completion distinct from a valid probe", () =>
    run(
      Effect.gen(function* () {
        const runtime = yield* runtimeWith(acmeModelsJson());
        const output = yield* inspectProvider(runtime, probe("hello", "resolved-acme-key"));
        expect(output).toEqual({
          result: { model: MODEL, response: probedResponse, validRequestReceived: false },
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
            model: MODEL,
            response: { inputTokens: 0, outputTokens: 0, stopReason: "error", text: "" },
            validRequestReceived: false,
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
  contextWindow: 32768,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: ADDED_MODEL_ID,
  input: ["text"],
  maxTokens: 4096,
  name: "Fixture Chat",
  provider: ADDED_PROVIDER,
  reasoning: true,
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
        expect(output).toEqual({ result: { existingModelsPreserved: true, model: ADDED_MODEL } });
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
