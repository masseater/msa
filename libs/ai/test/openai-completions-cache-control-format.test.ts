import { Clock, Effect, Stream } from "effect";
import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import openaiCompletions from "../src/api/openai-completions.ts";
import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import modelChoice from "./model-choice.ts";

const { stream: streamOpenAICompletions } = openaiCompletions;
const { normalizeContext } = compatModule;
const { currentTimeMillis } = clock;

const { chooseModel, compatValue, usesApi } = modelChoice;

const completions = usesApi("openai-completions");

const anthropicCacheModel = chooseModel(
  "openrouter",
  "Chat Completions with Anthropic cache markers",
  (model): model is typesModule.Model<"openai-completions"> =>
    completions(model) && compatValue(model, "cacheControlFormat") === "anthropic",
);

const emptyUsage: typesModule.Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

interface CacheControl {
  type: "ephemeral";
  ttl?: string;
}

interface TextPart {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

interface ToolWithCacheControl {
  type: string;
  cache_control?: CacheControl;
}

interface CapturedParams {
  messages: Array<{
    role: string;
    content: string | TextPart[] | null;
  }>;
  tools?: ToolWithCacheControl[];
}

const mockState = vi.hoisted(() => ({
  lastParams: undefined as CapturedParams | undefined,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: (params: CapturedParams) => {
          mockState.lastParams = params;
          const stream = {
            [Symbol.asyncIterator]() {
              return Stream.toAsyncIterable(
                Stream.fromIterable(
                  (function* () {
                    yield {
                      choices: [{ delta: {}, finish_reason: "stop" }],
                      id: "chatcmpl-test",
                      usage: {
                        completion_tokens: 1,
                        completion_tokens_details: { reasoning_tokens: 0 },
                        prompt_tokens: 1,
                        prompt_tokens_details: { cached_tokens: 0 },
                      },
                    };
                  })(),
                ),
              )[Symbol.asyncIterator]();
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
              response: { headers: new Headers(), status: 200 },
            });
          return promise;
        },
      },
    };
  }

  return { default: FakeOpenAI };
});

function capturePayload(
  model: typesModule.Model<"openai-completions">,
  options?: { cacheRetention?: "none" | "short" | "long" },
  messages?: typesModule.Message[],
): Promise<CapturedParams> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = yield* Clock.currentTimeMillis;

      yield* Effect.promise(() =>
        streamOpenAICompletions(
          model,
          normalizeContext({
            messages: messages ?? [{ content: "Hello", role: "user", timestamp }],
            systemPrompt: "System prompt",
            tools: [
              {
                description: "Read a file",
                name: "read",
                parameters: Type.Object({
                  path: Type.String(),
                }),
              },
            ],
          }),
          { apiKey: "test-key", ...options },
        ).result(),
      );

      if (mockState.lastParams === undefined) {
        throw new Error("Expected payload to be captured");
      }

      return mockState.lastParams;
    }),
  );
}

function getInstructionMessage(params: CapturedParams) {
  return params.messages.find(
    (message) => message.role === "system" || message.role === "developer",
  );
}

function expectAnthropicCacheMarkers(params: CapturedParams): void {
  const instructionMessage = getInstructionMessage(params);
  expect(instructionMessage).toBeDefined();
  expect(Array.isArray(instructionMessage?.content)).toBe(true);
  expect((instructionMessage?.content as TextPart[] | undefined)?.[0]?.cache_control).toEqual({
    type: "ephemeral",
  });

  expect(params.tools).toHaveLength(1);
  expect(params.tools?.[0]?.cache_control).toEqual({ type: "ephemeral" });

  const lastMessage = params.messages.at(-1);
  if (lastMessage === undefined) throw new Error("Expected a request message");
  expect(lastMessage.role).toBe("user");
  expect(Array.isArray(lastMessage.content)).toBe(true);
  expect((lastMessage.content as TextPart[])[0]?.cache_control).toEqual({ type: "ephemeral" });
}

describe("openai-completions cacheControlFormat", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
  });
  it("applies Anthropic-style cache markers when model compat enables them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: typesModule.Model<"openai-completions"> = {
          api: "openai-completions",
          baseUrl: "https://example.com/v1",
          compat: {
            cacheControlFormat: "anthropic",
          },
          contextWindow: 128000,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
          },
          id: "custom-qwen",
          input: ["text"],
          maxTokens: 32000,
          name: "Custom Qwen",
          provider: "openrouter",
          reasoning: true,
        };

        const params = yield* Effect.promise(() => capturePayload(model));
        expectAnthropicCacheMarkers(params);
      }),
    ));

  it("preserves Anthropic-style cache markers for OpenRouter Anthropic batch aliases", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = anthropicCacheModel;
        const params = yield* Effect.promise(() => capturePayload(model));
        expectAnthropicCacheMarkers(params);
      }),
    ));
});

describe("openai-completions cacheControlFormat", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
  });
  it("moves the conversation cache marker to a tool result", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = anthropicCacheModel;
        const timestamp = currentTimeMillis();
        const params = yield* Effect.promise(() =>
          capturePayload(model, undefined, [
            { content: "Read the file", role: "user", timestamp },
            {
              api: "openai-completions",
              content: [
                { arguments: { path: "README.md" }, id: "call_1", name: "read", type: "toolCall" },
              ],
              model: model.id,
              provider: "openrouter",
              role: "assistant",
              stopReason: "toolUse",
              timestamp,
              usage: emptyUsage,
            },
            {
              content: [{ text: "file contents", type: "text" }],
              isError: false,
              role: "toolResult",
              timestamp,
              toolCallId: "call_1",
              toolName: "read",
            },
          ]),
        );

        const userMessage = params.messages.find((message) => message.role === "user");
        expect(userMessage?.content).toBe("Read the file");

        const toolMessage = params.messages.at(-1);
        if (toolMessage === undefined) throw new Error("Expected a request message");
        expect(toolMessage.role).toBe("tool");
        expect(Array.isArray(toolMessage.content)).toBe(true);
        expect((toolMessage.content as TextPart[])[0]?.cache_control).toEqual({
          type: "ephemeral",
        });
      }),
    ));
});

describe("openai-completions cacheControlFormat", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
  });
  it("omits Anthropic-style cache markers when cacheRetention is none", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: typesModule.Model<"openai-completions"> = {
          api: "openai-completions",
          baseUrl: "https://example.com/v1",
          compat: {
            cacheControlFormat: "anthropic",
          },
          contextWindow: 128000,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
          },
          id: "custom-qwen",
          input: ["text"],
          maxTokens: 32000,
          name: "Custom Qwen",
          provider: "openrouter",
          reasoning: true,
        };
        const params = yield* Effect.promise(() =>
          capturePayload(model, { cacheRetention: "none" }),
        );
        const instructionMessage = getInstructionMessage(params);

        expect(Array.isArray(instructionMessage?.content)).toBe(false);
        expect(params.tools?.[0]?.cache_control).toBeUndefined();
        expect(typeof params.messages.at(-1)?.content).toBe("string");
      }),
    ));
});
