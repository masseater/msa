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

const { decodeJson } = jsonCodec;

const mergesConsecutiveTextAndSummaryReasoning = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const {
        textDelta,
        textDeltaWithSignature,
        summaryDelta,
        summaryDeltaWithFormat,
        laterSummaryDelta,
        expectedReasoningDetails,
      } = mergesConsecutiveTextAndSummaryReasoningStep1();

      mockState.chunkSets = [
        [
          chunk({ reasoning_details: [textDelta] }),
          chunk({ reasoning_details: [textDeltaWithSignature] }),
          chunk({ reasoning_details: [summaryDelta] }),
          chunk({ reasoning_details: [summaryDeltaWithFormat] }),
          chunk({ reasoning_details: [reasoningDetail] }),
          chunk({ reasoning_details: [laterSummaryDelta] }),
          toolCallChunk(),
          chunk({}, "tool_calls"),
        ],
        [chunk({ content: "ok" }), chunk({}, "stop")],
      ];

      const assistantMessage = yield* Effect.promise(() => runOpenAICompletionsStream());
      const thinking = assistantMessage.content.find((block) => block.type === "thinking");
      expect(thinking).toMatchObject({ thinking: "", type: "thinking" });
      expect(
        yield* decodeJson(thinking?.type === "thinking" ? (thinking.thinkingSignature ?? "") : ""),
      ).toEqual(expectedReasoningDetails);

      yield* Effect.promise(() => runOpenAICompletionsStream([assistantMessage]));

      expect(getAssistantPayload(mockState.payloads[1])?.reasoning_details).toEqual(
        expectedReasoningDetails,
      );
    }),
  );

function mergesConsecutiveTextAndSummaryReasoningStep1() {
  const textDelta = { index: 0, text: "The", type: "reasoning.text" };
  const textDeltaWithSignature = {
    format: "openai-responses-v1",
    index: 0,
    signature: "sha256:text-signature",
    text: " user wants the time.",
    type: "reasoning.text",
  };
  const summaryDelta = { index: 0, summary: "Looked", type: "reasoning.summary" };
  const summaryDeltaWithFormat = {
    format: "openai-responses-v1",
    index: 0,
    summary: " up time.",
    type: "reasoning.summary",
  };
  const laterSummaryDelta = {
    format: "openai-responses-v1",
    index: 0,
    summary: "After encrypted block.",
    type: "reasoning.summary",
  };
  const expectedReasoningDetails = [
    {
      format: "openai-responses-v1",
      index: 0,
      signature: "sha256:text-signature",
      text: "The user wants the time.",
      type: "reasoning.text",
    },
    {
      format: "openai-responses-v1",
      index: 0,
      summary: "Looked up time.",
      type: "reasoning.summary",
    },
    reasoningDetail,
    laterSummaryDelta,
  ];
  return {
    expectedReasoningDetails,
    laterSummaryDelta,
    summaryDelta,
    summaryDeltaWithFormat,
    textDelta,
    textDeltaWithSignature,
  };
}

describe("openai-completions reasoning_details streaming", () => {
  beforeEach(() => {
    mockState.chunkSets = [];
    mockState.payloads = [];
  });
  it(
    "merges consecutive text and summary reasoning_details deltas before replay",
    mergesConsecutiveTextAndSummaryReasoning,
  );
});
