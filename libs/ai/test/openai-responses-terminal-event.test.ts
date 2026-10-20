import { Effect, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, it, vi } from "vite-plus/test";

import { processResponsesStream } from "../src/api/openai-responses-stream.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import effectAssert from "./effect-assert.ts";
import openaiResponsesTerminalEventSupport from "./openai-responses-terminal-event-support.ts";

const { createModel, createOutput } = openaiResponsesTerminalEventSupport;

vi.mock("openai", () =>
  import("./openai-responses-terminal-event-mock.ts").then((module) => module.default),
);

const { expectDefect } = effectAssert;

function createEarlyEofEvents(): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          response: { id: "resp_early_eof" },
          sequence_number: 0,
          type: "response.created",
        } as ResponseStreamEvent;
        yield {
          item: { id: "rs_early_eof", summary: [], type: "reasoning" },
          output_index: 0,
          sequence_number: 1,
          type: "response.output_item.added",
        } as ResponseStreamEvent;
        yield {
          content_index: 0,
          delta: "partial reasoning before the stream ends",
          item_id: "rs_early_eof",
          output_index: 0,
          sequence_number: 2,
          type: "response.reasoning_text.delta",
        } as ResponseStreamEvent;
      })(),
    ),
  );
}

function createUnfinishedToolCallEvents(): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield {
          item: {
            arguments: "",
            call_id: "call_1",
            id: "fc_1",
            name: "bash",
            type: "function_call",
          },
          output_index: 0,
          sequence_number: 0,
          type: "response.output_item.added",
        } as ResponseStreamEvent;
        yield {
          delta: '{"command":"rm -rf /tmp/build',
          item_id: "fc_1",
          output_index: 0,
          sequence_number: 1,
          type: "response.function_call_arguments.delta",
        } as ResponseStreamEvent;
        yield {
          response: { id: "resp_unfinished", status: "completed" },
          sequence_number: 2,
          type: "response.completed",
        } as ResponseStreamEvent;
      })(),
    ),
  );
}

const rejectsStreamsThatEndBeforeA = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();
      const output = createOutput(model);
      const stream = new AssistantMessageEventStream();

      yield* expectDefect(
        processResponsesStream(createEarlyEofEvents(), output, stream, model),
        "OpenAI Responses stream ended before a terminal response event",
      );
    }),
  );

const rejectsCompletedStreamsWhoseToolCall = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();

      yield* expectDefect(
        processResponsesStream(
          createUnfinishedToolCallEvents(),
          createOutput(model),
          new AssistantMessageEventStream(),
          model,
        ),
        "OpenAI Responses stream completed with an unfinished tool call: bash (call_1|fc_1)",
      );
    }),
  );

describe("OpenAI Responses terminal event handling", () => {
  it("rejects streams that end before a terminal response event", rejectsStreamsThatEndBeforeA);

  it(
    "rejects completed streams whose tool call never received output_item.done",
    rejectsCompletedStreamsWhoseToolCall,
  );
});
