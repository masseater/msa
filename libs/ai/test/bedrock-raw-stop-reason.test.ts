import { Data, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const bedrockMock = vi.hoisted(() => ({
  stopReason: "end_turn" as string,
  streamEvents: undefined as unknown[] | undefined,
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class BedrockRuntimeServiceException extends Data.Error<{ readonly message: string }> {}

  class BedrockRuntimeClient {
    middlewareStack = {
      add: () => undefined,
    };

    send(): Promise<unknown> {
      return Promise.resolve({
        $metadata: { httpStatusCode: 200, requestId: "request-id" },
        stream: (async function* () {
          if (bedrockMock.streamEvents !== undefined) {
            yield* bedrockMock.streamEvents;
            return;
          }
          yield { messageStart: { role: "assistant" } };
          yield { messageStop: { stopReason: bedrockMock.stopReason } };
        })(),
      });
    }
  }

  class ConverseStreamCommand {
    readonly input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  return {
    BedrockRuntimeClient,
    BedrockRuntimeServiceException,
    ConverseStreamCommand,
    StopReason: {
      END_TURN: "end_turn",
      STOP_SEQUENCE: "stop_sequence",
      MAX_TOKENS: "max_tokens",
      MODEL_CONTEXT_WINDOW_EXCEEDED: "model_context_window_exceeded",
      TOOL_USE: "tool_use",
    },
    CachePointType: { DEFAULT: "default" },
    CacheTTL: { ONE_HOUR: "ONE_HOUR" },
    ConversationRole: { ASSISTANT: "assistant", USER: "user" },
    ImageFormat: { JPEG: "jpeg", PNG: "png", GIF: "gif", WEBP: "webp" },
    ToolResultStatus: { ERROR: "error", SUCCESS: "success" },
  };
});

import { stream as streamBedrock } from "../src/api/bedrock-converse-stream.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Api, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

beforeEach(() => {
  bedrockMock.streamEvents = undefined;
});

const model = getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");
const context = normalizeContext({
  messages: [{ role: "user", content: "hello", timestamp: currentTimeMillis() }],
});

describe("Bedrock provider stream events", () => {
  it("forwards SDK stream items in order before normalizing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const effectContext = yield* Effect.context();
        bedrockMock.streamEvents = [
          { messageStart: { role: "assistant" } },
          { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "hello" } } },
          {
            messageStop: {
              stopReason: "end_turn",
              additionalModelResponseFields: { source: "test" },
            },
          },
          { metadata: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } },
        ];
        const received: unknown[] = [];
        const eventModels: Model<Api>[] = [];
        const result = yield* Effect.promise(() =>
          streamBedrock(model, context, {
            cacheRetention: "none",
            onProviderStreamEvent: (item, eventModel) =>
              Effect.runPromiseWith(effectContext)(
                Effect.gen(function* () {
                  yield* Effect.promise(() => Promise.resolve());
                  received.push(item);
                  eventModels.push(eventModel);
                }),
              ),
          }).result(),
        );

        expect(received).toEqual(bedrockMock.streamEvents);
        for (const [index, item] of received.entries())
          expect(item).toBe(bedrockMock.streamEvents[index]);
        expect(eventModels).toEqual([model, model, model, model]);
        expect(result.stopReason).toBe("stop");
        expect(result.content).toEqual([{ type: "text", text: "hello" }]);
      }),
    ));
});

describe("Bedrock provider stream events", () => {
  it("forwards SDK error items before reporting them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exception = new Error("bedrock stream failed");
        bedrockMock.streamEvents = [
          { messageStart: { role: "assistant" } },
          { internalServerException: exception },
        ];
        const received: unknown[] = [];
        const result = yield* Effect.promise(() =>
          streamBedrock(model, context, {
            cacheRetention: "none",
            onProviderStreamEvent: (item) => {
              received.push(item);
            },
          }).result(),
        );

        expect(received).toEqual(bedrockMock.streamEvents);
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toBe("bedrock stream failed");
      }),
    ));
});

describe("Bedrock raw stop reasons", () => {
  it("preserves raw Bedrock stop reasons for successful stops", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        bedrockMock.stopReason = "end_turn";

        const message = yield* Effect.promise(() =>
          streamBedrock(model, context, { cacheRetention: "none" }).result(),
        );

        expect(message.stopReason).toBe("stop");
        expect(message.rawStopReason).toBe("end_turn");
        expect(message.errorMessage).toBeUndefined();
      }),
    ));

  it("preserves raw Bedrock stop reasons for provider error stops", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        bedrockMock.stopReason = "guardrail_intervened";

        const message = yield* Effect.promise(() =>
          streamBedrock(model, context, { cacheRetention: "none" }).result(),
        );

        expect(message.stopReason).toBe("error");
        expect(message.rawStopReason).toBe("guardrail_intervened");
        expect(message.errorMessage).toBe("Provider stopped with: guardrail_intervened");
      }),
    ));
});
