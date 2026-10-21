import { Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import openaiCompletionsReasoningDetailsSupport from "./openai-completions-reasoning-details-support.ts";

const { chunk, reasoningDetail, runOpenAICompletionsStream } =
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

const placesThinkingBeforeTextWhenOne = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunkSets = [
        [chunk({ content: "answer", reasoning_content: "thinking", role: "assistant" }, "stop")],
      ];

      const assistantMessage = yield* Effect.promise(() => runOpenAICompletionsStream());
      expect(assistantMessage.content).toEqual([
        { thinking: "thinking", thinkingSignature: "reasoning_content", type: "thinking" },
        { text: "answer", type: "text" },
      ]);
    }),
  );

const placesThinkingBeforeTextWhenOne2 = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      mockState.chunkSets = [
        [chunk({ content: "answer", reasoning_details: [reasoningDetail] }, "stop")],
      ];

      const assistantMessage = yield* Effect.promise(() => runOpenAICompletionsStream());
      expect(assistantMessage.content.map((block) => block.type)).toEqual(["thinking", "text"]);
    }),
  );

describe("openai-completions reasoning and content in one delta", () => {
  beforeEach(() => {
    mockState.chunkSets = [];
    mockState.payloads = [];
  });

  it(
    "places thinking before text when one delta carries reasoning_content and content",
    placesThinkingBeforeTextWhenOne,
  );

  it(
    "places thinking before text when one delta carries reasoning_details and content",
    placesThinkingBeforeTextWhenOne2,
  );
});
