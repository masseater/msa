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

const signedReasoningTextDetail = {
  format: "anthropic-claude-v1",
  id: "reasoning-text-1",
  index: 0,
  signature: "sha256:signed-text",
  text: "I should call the read tool.",
  type: "reasoning.text",
};

const reasoningSummaryDetail = {
  format: "anthropic-claude-v1",
  id: "reasoning-summary-1",
  index: 1,
  summary: "Decided to inspect the requested file.",
  type: "reasoning.summary",
};

const preservesSignedTextAndSummaryReasoning = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunkSets = [
        [
          chunk({
            reasoning: signedReasoningTextDetail.text,
            reasoning_details: [signedReasoningTextDetail],
          }),
          chunk({ reasoning_details: [reasoningDetail, reasoningSummaryDetail] }),
          toolCallChunk(),
          chunk({}, "tool_calls"),
        ],
        [chunk({ content: "ok" }), chunk({}, "stop")],
      ];

      const assistantMessage = yield* Effect.promise(() => runOpenAICompletionsStream());
      const expectedReasoningDetails = [
        signedReasoningTextDetail,
        reasoningDetail,
        reasoningSummaryDetail,
      ];
      const thinking = assistantMessage.content.find((block) => block.type === "thinking");
      expect(thinking).toEqual({
        thinking: signedReasoningTextDetail.text,
        thinkingSignature: yield* encodeJson(expectedReasoningDetails),
        type: "thinking",
      });

      yield* Effect.promise(() => runOpenAICompletionsStream([assistantMessage]));

      const payload = getAssistantPayload(mockState.payloads[1]);
      expect(payload?.reasoning_details).toEqual(expectedReasoningDetails);
      expect(payload?.reasoning).toBeUndefined();
    }),
  );

describe("openai-completions reasoning_details streaming", () => {
  beforeEach(() => {
    mockState.chunkSets = [];
    mockState.payloads = [];
  });
  it(
    "preserves signed text and summary reasoning_details in their original sequence",
    preservesSignedTextAndSummaryReasoning,
  );
});
