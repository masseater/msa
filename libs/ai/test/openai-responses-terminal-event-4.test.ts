import { Effect, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { processResponsesStream } from "../src/api/openai-responses-stream.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import openaiResponsesTerminalEventSupport from "./openai-responses-terminal-event-support.ts";

const { createModel, createOutput } = openaiResponsesTerminalEventSupport;

vi.mock("openai", () =>
  import("./openai-responses-terminal-event-mock.ts").then((module) => module.default),
);

function createCompletedEvents(): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          response: {
            id: "resp_completed",
            status: "completed",
            usage: {
              input_tokens: 20,
              input_tokens_details: { cache_write_tokens: 3, cached_tokens: 2 },
              output_tokens: 7,
              total_tokens: 27,
            },
          },
          sequence_number: 0,
          type: "response.completed",
        } as unknown as ResponseStreamEvent;
      })(),
    ),
  );
}

function createIncompleteEvents(reason = "max_output_tokens"): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          response: {
            id: "resp_incomplete",
            incomplete_details: { reason },
            status: "incomplete",
            usage: {
              input_tokens: 30,
              input_tokens_details: { cached_tokens: 5 },
              output_tokens: 12,
              total_tokens: 42,
            },
          },
          sequence_number: 0,
          type: "response.incomplete",
        } as ResponseStreamEvent;
      })(),
    ),
  );
}

const finalizesCompletedTerminalEventsAsStop = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();
      const output = createOutput(model);
      const stream = new AssistantMessageEventStream();

      yield* processResponsesStream(createCompletedEvents(), output, stream, model);

      expect(output.responseId).toBe("resp_completed");
      expect(output.stopReason).toBe("stop");
      expect(output.rawStopReason).toBe("completed");
      expect(output.usage).toMatchObject({
        cacheRead: 2,
        cacheWrite: 3,
        input: 15,
        output: 7,
        totalTokens: 27,
      });
    }),
  );

const finalizesIncompleteTerminalEventsAsLength = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();
      const output = createOutput(model);
      const stream = new AssistantMessageEventStream();

      yield* processResponsesStream(createIncompleteEvents(), output, stream, model);

      expect(output.responseId).toBe("resp_incomplete");
      expect(output.stopReason).toBe("length");
      expect(output.rawStopReason).toBe("incomplete.max_output_tokens");
      expect(output.usage).toMatchObject({
        cacheRead: 5,
        cacheWrite: 0,
        input: 25,
        output: 12,
        totalTokens: 42,
      });
    }),
  );

describe("OpenAI Responses terminal event handling", () => {
  it("finalizes completed terminal events as stop", finalizesCompletedTerminalEventsAsStop);

  it(
    "finalizes incomplete terminal events as length stops",
    finalizesIncompleteTerminalEventsAsLength,
  );
});

const finalizesContentFilteredIncompleteResponsesAs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();
      const output = createOutput(model);
      const stream = new AssistantMessageEventStream();

      yield* processResponsesStream(
        createIncompleteEvents("content_filter"),
        output,
        stream,
        model,
      );

      expect(output.stopReason).toBe("error");
      expect(output.rawStopReason).toBe("incomplete.content_filter");
      expect(output.errorMessage).toBe("Response incomplete: content_filter");
    }),
  );

const preservesUnknownProviderIncompleteReasonsAs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();
      const output = createOutput(model);
      const stream = new AssistantMessageEventStream();

      yield* processResponsesStream(
        createIncompleteEvents("max_time_limit"),
        output,
        stream,
        model,
      );

      expect(output.stopReason).toBe("error");
      expect(output.rawStopReason).toBe("incomplete.max_time_limit");
      expect(output.errorMessage).toBe("Response incomplete: max_time_limit");
    }),
  );

describe("OpenAI Responses terminal event handling", () => {
  it(
    "finalizes content-filtered incomplete responses as non-retryable errors",
    finalizesContentFilteredIncompleteResponsesAs,
  );

  it(
    "preserves unknown provider incomplete reasons as non-retryable errors",
    preservesUnknownProviderIncompleteReasonsAs,
  );
});
