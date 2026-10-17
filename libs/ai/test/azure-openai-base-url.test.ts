import { arch, platform, release } from "node:os";

import { Effect } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { stream as streamAzureOpenAIResponses } from "../src/api/azure-openai-responses.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Api, Context, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { envValue } from "./env.ts";

interface CapturedAzureClientOptions {
  apiKey: string;
  apiVersion: string;
  dangerouslyAllowBrowser: boolean;
  defaultHeaders?: Record<string, string>;
  baseURL: string;
}

interface CapturedAzureResponsesPayload {
  prompt_cache_key?: string;
  store?: boolean;
  tools?: Array<{ strict?: boolean }>;
}

const azureMock = vi.hoisted(() => ({
  constructorCalls: [] as CapturedAzureClientOptions[],
  lastParams: undefined as CapturedAzureResponsesPayload | undefined,
  streamEvents: undefined as ResponseStreamEvent[] | undefined,
}));

vi.mock("openai", () => {
  class AzureOpenAI {
    responses = {
      create: (params: CapturedAzureResponsesPayload) => {
        azureMock.lastParams = params;
        const events = azureMock.streamEvents;
        if (events === undefined) throw new Error("mock create");
        return {
          withResponse: () =>
            Promise.resolve({
              data: (async function* () {
                for (const event of events) yield event;
              })(),
              response: { status: 200, headers: new Headers() },
            }),
        };
      },
    };

    constructor(config: CapturedAzureClientOptions) {
      azureMock.constructorCalls.push(config);
    }
  }

  return { AzureOpenAI };
});

const MSA_USER_AGENT = `pi (${platform()} ${release()}; ${arch()})`;

const context: Context = {
  messages: [{ role: "user", content: "hello", timestamp: currentTimeMillis() }],
};

const originalAzureOpenAIBaseUrl = envValue("AZURE_OPENAI_BASE_URL");
const originalAzureOpenAIResourceName = envValue("AZURE_OPENAI_RESOURCE_NAME");
const originalAzureOpenAIApiVersion = envValue("AZURE_OPENAI_API_VERSION");
const originalAzureOpenAIApiKey = envValue("AZURE_OPENAI_API_KEY");

beforeEach(() => {
  azureMock.constructorCalls.length = 0;
  azureMock.lastParams = undefined;
  azureMock.streamEvents = undefined;
  vi.stubEnv("AZURE_OPENAI_BASE_URL", undefined);
  vi.stubEnv("AZURE_OPENAI_RESOURCE_NAME", undefined);
  vi.stubEnv("AZURE_OPENAI_API_VERSION", undefined);
  vi.stubEnv("AZURE_OPENAI_API_KEY", undefined);
});

afterEach(() => {
  if (originalAzureOpenAIBaseUrl === undefined) {
    vi.stubEnv("AZURE_OPENAI_BASE_URL", undefined);
  } else {
    vi.stubEnv("AZURE_OPENAI_BASE_URL", originalAzureOpenAIBaseUrl);
  }

  if (originalAzureOpenAIResourceName === undefined) {
    vi.stubEnv("AZURE_OPENAI_RESOURCE_NAME", undefined);
  } else {
    vi.stubEnv("AZURE_OPENAI_RESOURCE_NAME", originalAzureOpenAIResourceName);
  }

  if (originalAzureOpenAIApiVersion === undefined) {
    vi.stubEnv("AZURE_OPENAI_API_VERSION", undefined);
  } else {
    vi.stubEnv("AZURE_OPENAI_API_VERSION", originalAzureOpenAIApiVersion);
  }

  if (originalAzureOpenAIApiKey === undefined) {
    vi.stubEnv("AZURE_OPENAI_API_KEY", undefined);
  } else {
    vi.stubEnv("AZURE_OPENAI_API_KEY", originalAzureOpenAIApiKey);
  }
});

const captureClientBaseUrl = Effect.fn("captureClientBaseUrl")(function* (baseUrl: string) {
  vi.stubEnv("AZURE_OPENAI_BASE_URL", baseUrl);
  const model = getModel("azure", "gpt-4o-mini");
  yield* Effect.promise(() =>
    streamAzureOpenAIResponses(model, normalizeContext(context), {
      apiKey: "test-api-key",
    }).result(),
  );
  expect(azureMock.constructorCalls).toHaveLength(1);
  const [call] = azureMock.constructorCalls;
  if (call === undefined) throw new Error("Expected an AzureOpenAI constructor call");
  return call.baseURL;
});

const captureClientHeaders = Effect.fn("captureClientHeaders")(function* (
  headers?: Record<string, string>,
) {
  const model = getModel("azure", "gpt-4o-mini");
  yield* Effect.promise(() =>
    streamAzureOpenAIResponses(model, normalizeContext(context), {
      apiKey: "test-api-key",
      azureBaseUrl: "https://my-resource.openai.azure.com",
      headers,
    }).result(),
  );
  expect(azureMock.constructorCalls).toHaveLength(1);
  const [call] = azureMock.constructorCalls;
  if (call === undefined) throw new Error("Expected an AzureOpenAI constructor call");
  return call.defaultHeaders ?? {};
});

describe("azure base URL normalization", () => {
  it("normalizes Cognitive Services root endpoints to /openai/v1", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl(
          "https://marc-quicktests-resource.cognitiveservices.azure.com",
        );
        expect(baseURL).toBe(
          "https://marc-quicktests-resource.cognitiveservices.azure.com/openai/v1",
        );
      }),
    ));

  it("normalizes Microsoft Foundry root endpoints to /openai/v1", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl(
          "https://marc-quicktests-resource.ai.azure.com",
        );
        expect(baseURL).toBe("https://marc-quicktests-resource.ai.azure.com/openai/v1");
      }),
    ));

  it("normalizes Azure OpenAI root endpoints to /openai/v1", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl("https://my-resource.openai.azure.com");
        expect(baseURL).toBe("https://my-resource.openai.azure.com/openai/v1");
      }),
    ));

  it("normalizes /openai to /openai/v1", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl(
          "https://my-resource.cognitiveservices.azure.com/openai",
        );
        expect(baseURL).toBe("https://my-resource.cognitiveservices.azure.com/openai/v1");
      }),
    ));

  it("preserves /openai/v1 endpoints", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl(
          "https://my-resource.cognitiveservices.azure.com/openai/v1",
        );
        expect(baseURL).toBe("https://my-resource.cognitiveservices.azure.com/openai/v1");
      }),
    ));

  it("normalizes /openai/v1/responses to /openai/v1", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl(
          "https://my-resource.services.ai.azure.com/openai/v1/responses",
        );
        expect(baseURL).toBe("https://my-resource.services.ai.azure.com/openai/v1");
      }),
    ));

  it("preserves explicit non-Azure proxy paths", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl("https://my-proxy.example.com/v1");
        expect(baseURL).toBe("https://my-proxy.example.com/v1");
      }),
    ));

  it("strips query params when normalizing Azure host URLs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl(
          "https://my-resource.openai.azure.com/openai?api-version=2024-12-01",
        );
        expect(baseURL).toBe("https://my-resource.openai.azure.com/openai/v1");
      }),
    ));

  it("preserves query params on non-Azure proxy URLs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseURL = yield* captureClientBaseUrl("https://my-proxy.example.com/v1?custom=true");
        expect(baseURL).toBe("https://my-proxy.example.com/v1?custom=true");
      }),
    ));

  it("throws on invalid URLs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AZURE_OPENAI_BASE_URL", "not-a-url");
        const model = getModel("azure", "gpt-4o-mini");
        const result = yield* Effect.promise(() =>
          streamAzureOpenAIResponses(model, normalizeContext(context), {
            apiKey: "test-api-key",
          }).result(),
        );
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("Invalid Azure OpenAI base URL");
      }),
    ));

  it("clamps prompt_cache_key to OpenAI's 64-character limit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("azure", "gpt-4o-mini");
        yield* Effect.promise(() =>
          streamAzureOpenAIResponses(model, normalizeContext(context), {
            apiKey: "test-api-key",
            azureBaseUrl: "https://my-resource.openai.azure.com",
            sessionId: "x".repeat(67),
          }).result(),
        );

        expect(azureMock.lastParams?.prompt_cache_key).toBe("x".repeat(64));
      }),
    ));

  it("disables server-side response storage", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("azure", "gpt-4o-mini");
        yield* Effect.promise(() =>
          streamAzureOpenAIResponses(model, normalizeContext(context), {
            apiKey: "test-api-key",
            azureBaseUrl: "https://my-resource.openai.azure.com",
          }).result(),
        );

        expect(azureMock.lastParams?.store).toBe(false);
      }),
    ));

  it("honors supportsStrictMode: false", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseModel = getModel("azure", "gpt-4o-mini");
        const model: Model<"azure-openai-responses"> = {
          ...baseModel,
          compat: { ...baseModel.compat, supportsStrictMode: false },
        };

        yield* Effect.promise(() =>
          streamAzureOpenAIResponses(
            model,
            normalizeContext({
              ...context,
              tools: [
                {
                  name: "preferred",
                  description: "Preferred constrained tool",
                  parameters: Type.Object({ value: Type.String() }),
                  constrainedSampling: { type: "json_schema", strict: "prefer" },
                },
              ],
            }),
            { apiKey: "test-api-key", azureBaseUrl: "https://my-resource.openai.azure.com" },
          ).result(),
        );

        expect(azureMock.lastParams?.tools?.[0]).not.toHaveProperty("strict");
      }),
    ));

  it("builds correct default URL from AZURE_OPENAI_RESOURCE_NAME", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AZURE_OPENAI_RESOURCE_NAME", "my-resource");
        const model = getModel("azure", "gpt-4o-mini");
        yield* Effect.promise(() =>
          streamAzureOpenAIResponses(model, normalizeContext(context), {
            apiKey: "test-api-key",
          }).result(),
        );
        expect(azureMock.constructorCalls).toHaveLength(1);
        expect(azureMock.constructorCalls[0]?.baseURL).toBe(
          "https://my-resource.openai.azure.com/openai/v1",
        );
      }),
    ));
});

describe("azure provider stream events", () => {
  it("forwards parsed events in order before normalizing the response", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const effectContext = yield* Effect.context();
        azureMock.streamEvents = [
          {
            type: "response.created",
            sequence_number: 0,
            response: { id: "resp_azure" },
          } as ResponseStreamEvent,
          {
            type: "response.completed",
            sequence_number: 1,
            response: { id: "resp_azure", status: "completed" },
          } as ResponseStreamEvent,
        ];
        const model = getModel("azure", "gpt-4o-mini");
        const received: unknown[] = [];
        const eventModels: Model<Api>[] = [];
        const result = yield* Effect.promise(() =>
          streamAzureOpenAIResponses(model, normalizeContext(context), {
            apiKey: "test-api-key",
            azureBaseUrl: "https://my-resource.openai.azure.com",
            onProviderStreamEvent: (event, eventModel) =>
              Effect.runPromiseWith(effectContext)(
                Effect.gen(function* () {
                  yield* Effect.promise(() => Promise.resolve());
                  received.push(event);
                  eventModels.push(eventModel);
                }),
              ),
          }).result(),
        );

        expect(received).toEqual(azureMock.streamEvents);
        expect(received[0]).toBe(azureMock.streamEvents[0]);
        expect(received[1]).toBe(azureMock.streamEvents[1]);
        expect(eventModels).toEqual([model, model]);
        expect(result.stopReason).toBe("stop");
        expect(result.responseId).toBe("resp_azure");
      }),
    ));
});

describe("azure user agent", () => {
  it("uses msa's User-Agent by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* captureClientHeaders())["User-Agent"]).toBe(MSA_USER_AGENT);
      }),
    ));

  it("lets explicit headers override the default User-Agent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* captureClientHeaders({ "User-Agent": "custom-agent" }))["User-Agent"]).toBe(
          "custom-agent",
        );
      }),
    ));
});
