import { Clock, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getModel, normalizeContext } from "../src/compat.ts";
import { azureProvider } from "../src/providers/azure.ts";
import type { AssistantMessage, Context } from "../src/types.ts";
import { envValue } from "./env.ts";

interface FakeOpenAIClientOptions {
  apiKey: string;
  baseURL: string;
}

interface CapturedCompletionsPayload {
  model?: string;
  messages?: Array<{ role: string; content?: unknown; reasoning_content?: string }>;
  reasoning_effort?: string;
  thinking?: unknown;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
}

const mockState = vi.hoisted(() => ({
  lastParams: undefined as CapturedCompletionsPayload | undefined,
  lastClientOptions: undefined as FakeOpenAIClientOptions | undefined,
  dispatchedTo: undefined as "chat.completions" | "responses" | undefined,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: (params: CapturedCompletionsPayload) => {
          mockState.lastParams = params;
          mockState.dispatchedTo = "chat.completions";
          const stream = {
            async *[Symbol.asyncIterator]() {
              yield {
                choices: [{ delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  prompt_tokens_details: { cached_tokens: 0 },
                },
              };
            },
          };
          const promise = Promise.resolve(stream) as Promise<typeof stream> & {
            withResponse: () => Promise<{
              data: typeof stream;
              response: { status: number; headers: Headers };
            }>;
          };
          promise.withResponse = () =>
            Promise.resolve({
              data: stream,
              response: { status: 200, headers: new Headers() },
            });
          return promise;
        },
      },
    };

    constructor(options: FakeOpenAIClientOptions) {
      mockState.lastClientOptions = options;
    }
  }

  class FakeAzureOpenAI {
    responses = {
      create: () => {
        mockState.dispatchedTo = "responses";
        throw new Error("responses reached");
      },
    };
  }

  return { default: FakeOpenAI, AzureOpenAI: FakeAzureOpenAI };
});

const azure = azureProvider();

const originalBaseUrl = envValue("AZURE_OPENAI_BASE_URL");
const originalCacheRetention = envValue("MSA_CACHE_RETENTION");
const originalDeploymentMap = envValue("AZURE_OPENAI_DEPLOYMENT_NAME_MAP");

beforeEach(() => {
  mockState.lastParams = undefined;
  mockState.lastClientOptions = undefined;
  mockState.dispatchedTo = undefined;
  vi.stubEnv("MSA_CACHE_RETENTION", undefined);
  vi.stubEnv("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", undefined);
  vi.stubEnv("AZURE_OPENAI_BASE_URL", "https://my-resource.services.ai.azure.com");
});

afterEach(() => {
  if (originalBaseUrl === undefined) vi.stubEnv("AZURE_OPENAI_BASE_URL", undefined);
  else vi.stubEnv("AZURE_OPENAI_BASE_URL", originalBaseUrl);
  if (originalCacheRetention === undefined) vi.stubEnv("MSA_CACHE_RETENTION", undefined);
  else vi.stubEnv("MSA_CACHE_RETENTION", originalCacheRetention);
  if (originalDeploymentMap === undefined)
    vi.stubEnv("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", undefined);
  else vi.stubEnv("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", originalDeploymentMap);
});

const context = normalizeContext({
  systemPrompt: "sys",
  messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
});

function deepSeekModel() {
  return getModel("azure", "deepseek-v4-pro");
}

describe("azure deepseek-v4-pro over Chat Completions", () => {
  it("turns thinking on with reasoning_effort instead of DeepSeek's thinking field", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          azure
            .streamSimple(deepSeekModel(), context, { apiKey: "test-key", reasoning: "high" })
            .result(),
        );

        expect(mockState.lastParams?.reasoning_effort).toBe("high");
        expect(mockState.lastParams?.thinking).toBeUndefined();
      }),
    ));

  it("clamps thinking levels the deployment does not accept", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          azure
            .streamSimple(deepSeekModel(), context, { apiKey: "test-key", reasoning: "max" })
            .result(),
        );

        expect(mockState.lastParams?.reasoning_effort).toBe("high");
      }),
    ));

  it("sends no reasoning_effort when no thinking level is requested", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          azure.streamSimple(deepSeekModel(), context, { apiKey: "test-key" }).result(),
        );

        expect(mockState.lastParams?.reasoning_effort).toBeUndefined();
        expect(mockState.lastParams?.thinking).toBeUndefined();
      }),
    ));

  it("omits prompt cache parameters when long retention comes from MSA_CACHE_RETENTION", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("MSA_CACHE_RETENTION", "long");

        yield* Effect.promise(() =>
          azure
            .stream(deepSeekModel(), context, { apiKey: "test-key", sessionId: "session-env" })
            .result(),
        );

        expect(mockState.lastParams?.prompt_cache_key).toBeUndefined();
        expect(mockState.lastParams?.prompt_cache_retention).toBeUndefined();
      }),
    ));

  it("sends the system prompt under the system role", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          azure
            .stream(deepSeekModel(), context, { apiKey: "test-key", reasoningEffort: "low" })
            .result(),
        );

        expect(mockState.lastParams?.messages?.[0]).toMatchObject({
          role: "system",
          content: "sys",
        });
      }),
    ));

  it("keeps mid-conversation system messages in place", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const resumed = normalizeContext({
          systemPrompt: "first",
          messages: [
            { role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis },
            { role: "system", content: "second", timestamp: yield* Clock.currentTimeMillis },
            { role: "user", content: "again", timestamp: yield* Clock.currentTimeMillis },
          ],
        });

        yield* Effect.promise(() =>
          azure.stream(deepSeekModel(), resumed, { apiKey: "test-key" }).result(),
        );

        expect(mockState.lastParams?.messages?.map((message) => message.role)).toEqual([
          "system",
          "user",
          "system",
          "user",
        ]);
      }),
    ));

  it("omits prompt cache parameters even when long retention is requested", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          azure
            .stream(deepSeekModel(), context, {
              apiKey: "test-key",
              cacheRetention: "long",
              sessionId: "session-1",
            })
            .result(),
        );

        expect(mockState.lastParams?.prompt_cache_key).toBeUndefined();
        expect(mockState.lastParams?.prompt_cache_retention).toBeUndefined();
      }),
    ));

  it("replays reasoning_content on assistant turns so the cached prefix is unchanged", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const assistant: AssistantMessage = {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "internal reasoning",
              thinkingSignature: "reasoning_content",
            },
            { type: "text", text: "answer" },
          ],
          provider: "azure",
          api: "openai-completions",
          model: "deepseek-v4-pro",
          timestamp: yield* Clock.currentTimeMillis,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
        };
        const resumed: Context = {
          systemPrompt: "sys",
          messages: [
            { role: "user", content: "first", timestamp: yield* Clock.currentTimeMillis },
            assistant,
            { role: "user", content: "second", timestamp: yield* Clock.currentTimeMillis },
          ],
        };

        yield* Effect.promise(() =>
          azure.stream(deepSeekModel(), normalizeContext(resumed), { apiKey: "test-key" }).result(),
        );

        const assistantMessage = mockState.lastParams?.messages?.find(
          (message) => message.role === "assistant",
        );
        expect(assistantMessage?.reasoning_content).toBe("internal reasoning");
      }),
    ));
});

describe("azure Chat Completions endpoint resolution", () => {
  it("normalizes the Azure endpoint the completions client is built with", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          azure.stream(deepSeekModel(), context, { apiKey: "test-key" }).result(),
        );

        expect(mockState.lastClientOptions?.baseURL).toBe(
          "https://my-resource.services.ai.azure.com/openai/v1",
        );
      }),
    ));

  it("surfaces an unconfigured endpoint as an error event rather than throwing out of stream()", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AZURE_OPENAI_BASE_URL", undefined);

        const result = yield* Effect.promise(() =>
          azure.stream(deepSeekModel(), context, { apiKey: "test-key" }).result(),
        );

        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("Azure OpenAI base URL is required");
      }),
    ));

  it("sends the model id as the request model", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          azure.stream(deepSeekModel(), context, { apiKey: "test-key" }).result(),
        );

        expect(mockState.lastParams?.model).toBe("deepseek-v4-pro");
        expect(result.model).toBe("deepseek-v4-pro");
      }),
    ));

  it("sends the mapped deployment name while keeping the catalog id on the message", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", "deepseek-v4-pro=my-deepseek");

        const result = yield* Effect.promise(() =>
          azure.streamSimple(deepSeekModel(), context, { apiKey: "test-key" }).result(),
        );

        expect(mockState.lastParams?.model).toBe("my-deepseek");
        expect(result.model).toBe("deepseek-v4-pro");
      }),
    ));

  it("passes the deployment name through a caller's onPayload", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", "deepseek-v4-pro=my-deepseek");
        let seenModel: unknown;

        yield* Effect.promise(() =>
          azure
            .stream(deepSeekModel(), context, {
              apiKey: "test-key",
              onPayload: (payload) => {
                seenModel = (payload as CapturedCompletionsPayload).model;
                return { ...(payload as object), temperature: 0.1 };
              },
            })
            .result(),
        );

        expect(seenModel).toBe("my-deepseek");
        expect(mockState.lastParams).toMatchObject({ model: "my-deepseek", temperature: 0.1 });
      }),
    ));
});

describe("azure api map", () => {
  it("still routes Responses models to the Responses api", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          azure.stream(getModel("azure", "gpt-4o-mini"), context, { apiKey: "test-key" }).result(),
        );

        expect(mockState.dispatchedTo).toBe("responses");
      }),
    ));

  it("routes openai-completions models to chat completions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          azure.stream(deepSeekModel(), context, { apiKey: "test-key" }).result(),
        );

        expect(mockState.dispatchedTo).toBe("chat.completions");
      }),
    ));
});
