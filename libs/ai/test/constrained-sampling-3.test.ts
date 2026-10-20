import { Effect, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vite-plus/test";

import { processResponsesStream } from "../src/api/openai-responses-stream.ts";
import type { AssistantMessage, ToolCall } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import constrainedSamplingSupport from "./constrained-sampling-support.ts";
import jsonCodec from "./json-codec.ts";

const { makeModel, makeUsage } = constrainedSamplingSupport;
const { decodeJson } = jsonCodec;

function makeOutput(): AssistantMessage {
  return {
    api: "openai-responses",
    content: [],
    model: "gpt-test",
    provider: "openai",
    role: "assistant",
    stopReason: "pending",
    timestamp: currentTimeMillis(),
    usage: makeUsage(),
  };
}

function iterateEvents(events: ResponseStreamEvent[]): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        yield* events;
      })(),
    ),
  );
}

function captureToolCallEvents(stream: AssistantMessageEventStream): {
  starts: ToolCall["arguments"][];
  deltas: string[];
} {
  const starts: ToolCall["arguments"][] = [];
  const deltas: string[] = [];
  const originalPush = stream.push.bind(stream);
  stream.push = (event) => {
    if (event.type === "toolcall_start") {
      const block = event.partial.content[event.contentIndex];
      if (block?.type === "toolCall") starts.push(structuredClone(block.arguments));
    } else if (event.type === "toolcall_delta") {
      deltas.push(event.delta);
    }
    originalPush(event);
  };
  return { deltas, starts };
}

const customToolCallEvents = [
  {
    item: {
      call_id: "call_1",
      id: "ctc_1",
      input: "a",
      name: "sample_tool",
      type: "custom_tool_call",
    },
    output_index: 0,
    type: "response.output_item.added",
  },
  {
    delta: "b",
    item_id: "ctc_1",
    output_index: 0,
    type: "response.custom_tool_call_input.delta",
  },
  {
    input: "abc",
    item_id: "ctc_1",
    output_index: 0,
    type: "response.custom_tool_call_input.done",
  },
  {
    item: {
      call_id: "call_1",
      id: "ctc_1",
      input: "abc",
      name: "sample_tool",
      type: "custom_tool_call",
    },
    output_index: 0,
    type: "response.output_item.done",
  },
  {
    response: {
      status: "completed",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
    type: "response.completed",
  },
];

const startsCustomToolCallsWithInitialInput = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const output = makeOutput();
      const stream = new AssistantMessageEventStream();
      const { starts, deltas } = captureToolCallEvents(stream);
      yield* processResponsesStream(
        iterateEvents(customToolCallEvents as ResponseStreamEvent[]),
        output,
        stream,
        makeModel(),
        { grammarToolInputProperties: new Map([["sample_tool", "payload"]]) },
      );

      expect(output.stopReason).toBe("toolUse");
      expect(starts).toEqual([{ payload: "a" }]);
      expect(output.content).toEqual([
        {
          arguments: { payload: "abc" },
          id: "call_1|ctc_1",
          name: "sample_tool",
          type: "toolCall",
        },
      ]);
      expect(yield* decodeJson(deltas.join(""))).toEqual({ payload: "abc" });
    }),
  );

describe("constrained tool sampling", () => {
  it(
    "starts custom Responses tool calls with their initial input",
    startsCustomToolCallsWithInitialInput,
  );
});
