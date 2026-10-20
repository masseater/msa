import { Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import jsonCodec from "./json-codec.ts";
import openaiCompletionsReasoningDetailsSupport from "./openai-completions-reasoning-details-support.ts";

const { chunk, getAssistantPayload, reasoningDetail, runOpenAICompletionsStream, toolCallChunk } =
  openaiCompletionsReasoningDetailsSupport;

const mockState = vi.hoisted(() => ({
  chunkSets: [] as unknown[][],
  payloads: [] as unknown[],
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: (payload: unknown) => {
          mockState.payloads.push(payload);
          const chunks = mockState.chunkSets.shift() ?? [];
          const stream = {
            [Symbol.asyncIterator]() {
              return Stream.toAsyncIterable(
                Stream.fromIterable(
                  (function* () {
                    for (const streamChunk of chunks) {
                      yield streamChunk;
                    }
                  })(),
                ),
              )[Symbol.asyncIterator]();
            },
          };
          const result = Promise.resolve(stream) as Promise<typeof stream> & {
            withResponse: () => Promise<{
              data: typeof stream;
              response: { status: number; headers: Headers };
            }>;
          };
          result.withResponse = () =>
            Promise.resolve({
              data: stream,
              response: { headers: new Headers(), status: 200 },
            });
          return result;
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

const { encodeJson } = jsonCodec;

const preservesReasoningDetailsInTheThinking = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunkSets = [
        [chunk({ reasoning_details: [reasoningDetail] }), toolCallChunk(), chunk({}, "tool_calls")],
        [chunk({ content: "ok" }), chunk({}, "stop")],
      ];

      const assistantMessage = yield* Effect.promise(() => runOpenAICompletionsStream());
      const thinking = assistantMessage.content.find((block) => block.type === "thinking");
      expect(thinking).toEqual({
        thinking: "",
        thinkingSignature: yield* encodeJson([reasoningDetail]),
        type: "thinking",
      });
      const toolCall = assistantMessage.content.find((block) => block.type === "toolCall");
      expect(toolCall).toEqual({
        arguments: { path: "README.md" },
        id: "call_1",
        name: "read",
        type: "toolCall",
      });

      yield* Effect.promise(() => runOpenAICompletionsStream([assistantMessage]));

      expect(getAssistantPayload(mockState.payloads[1])?.reasoning_details).toEqual([
        reasoningDetail,
      ]);
    }),
  );

const fallsBackToEncryptedToolCall = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunkSets = [
        [chunk({ reasoning_details: [reasoningDetail] }), toolCallChunk(), chunk({}, "tool_calls")],
        [chunk({ content: "ok" }), chunk({}, "stop")],
      ];

      const assistantMessage = yield* Effect.promise(() => runOpenAICompletionsStream());
      assistantMessage.content = assistantMessage.content.filter(
        (block) => block.type !== "thinking",
      );
      const toolCall = assistantMessage.content.find((block) => block.type === "toolCall");
      if (toolCall === undefined || toolCall.type !== "toolCall")
        throw new Error("Expected tool call");
      toolCall.thoughtSignature = yield* encodeJson(reasoningDetail);

      yield* Effect.promise(() => runOpenAICompletionsStream([assistantMessage]));

      expect(getAssistantPayload(mockState.payloads[1])?.reasoning_details).toEqual([
        reasoningDetail,
      ]);
    }),
  );

describe("openai-completions reasoning_details streaming", () => {
  beforeEach(() => {
    mockState.chunkSets = [];
    mockState.payloads = [];
  });
  it(
    "preserves reasoning_details in the thinking signature",
    preservesReasoningDetailsInTheThinking,
  );
});

describe("openai-completions reasoning_details streaming", () => {
  beforeEach(() => {
    mockState.chunkSets = [];
    mockState.payloads = [];
  });
  it(
    "falls back to encrypted tool-call signatures for older stored assistant messages",
    fallsBackToEncryptedToolCall,
  );
});
