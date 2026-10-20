import { Effect, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiResponsesStream from "../src/api/openai-responses-stream.ts";
import openaiResponses from "../src/api/openai-responses.ts";
import type typesModule from "../src/types.types.ts";
import eventStream from "../src/utils/event-stream.ts";
import transcript from "../src/utils/transcript.ts";
import effectAssert from "./effect-assert.ts";
import openaiResponsesTerminalEventSupport from "./openai-responses-terminal-event-support.ts";

const { processResponsesStream } = openaiResponsesStream;
const { AssistantMessageEventStream } = eventStream;
const { normalizeContext } = transcript;
const { stream: streamOpenAIResponses } = openaiResponses;

const { createModel, createOutput } = openaiResponsesTerminalEventSupport;

vi.mock("openai", () =>
  import("./openai-responses-terminal-event-mock.ts").then((module) => module.default),
);

const { expectDefect } = effectAssert;

function createToolCallsWithoutOutputIndexEvents(): AsyncIterable<ResponseStreamEvent> {
  return Stream.toAsyncIterable(
    Stream.fromIterable(
      (function* () {
        const call = (n: string) => ({
          call_id: `call_${n}`,
          id: `fc_${n}`,
          name: "bash",
          type: "function_call",
        });
        const events = [
          { item: { ...call("a"), arguments: "" }, type: "response.output_item.added" },
          {
            delta: '{"command":"echo a"}',
            item_id: "fc_a",
            type: "response.function_call_arguments.delta",
          },
          { item: { ...call("b"), arguments: "" }, type: "response.output_item.added" },
          {
            delta: '{"command":"echo b"}',
            item_id: "fc_b",
            type: "response.function_call_arguments.delta",
          },
          {
            item: { ...call("a"), arguments: '{"command":"echo a"}' },
            type: "response.output_item.done",
          },
          {
            item: { ...call("b"), arguments: '{"command":"echo b"}' },
            type: "response.output_item.done",
          },
          {
            response: { id: "resp_no_output_index", status: "completed" },
            type: "response.completed",
          },
        ];
        for (const event of events) yield event as unknown as ResponseStreamEvent;
      })(),
    ),
  );
}

const rejectsParallelToolCallsWithoutOutput = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();

      yield* expectDefect(
        processResponsesStream(
          createToolCallsWithoutOutputIndexEvents(),
          createOutput(model),
          new AssistantMessageEventStream(),
          model,
        ),
        "OpenAI Responses stream completed with an unfinished tool call: bash (call_a|fc_a)",
      );
    }),
  );

describe("OpenAI Responses terminal event handling", () => {
  it(
    "rejects parallel tool calls without output_index instead of running mixed-up calls",
    rejectsParallelToolCallsWithoutOutput,
  );
});

const forwardsParsedProviderStreamEventsIn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context();
      const model = createModel();
      const context = normalizeContext({
        messages: [{ content: [{ text: "hi", type: "text" }], role: "user", timestamp: 0 }],
        systemPrompt: "",
        tools: [],
      });
      const providerEvents: unknown[] = [];
      const eventModels: typesModule.Model<typesModule.Api>[] = [];
      const stream = streamOpenAIResponses(model, context, {
        apiKey: "test",
        onProviderStreamEvent: (event, eventModel) =>
          Effect.runPromiseWith(effectContext)(
            Effect.gen(function* () {
              yield* Effect.promise(() => Promise.resolve());
              providerEvents.push(event);
              eventModels.push(eventModel);
            }),
          ),
      });

      yield* Effect.promise(() => stream.result());

      expect(providerEvents).toHaveLength(3);
      expect(providerEvents.map((event) => (event as ResponseStreamEvent).type)).toEqual([
        "response.created",
        "response.output_item.added",
        "response.reasoning_text.delta",
      ]);
      expect(eventModels).toEqual([model, model, model]);
    }),
  );

describe("OpenAI Responses terminal event handling", () => {
  it("forwards parsed provider stream events in order", forwardsParsedProviderStreamEventsIn);
});

const emitsAnErrorFinalResultWhen = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = createModel();
      const context = normalizeContext({
        messages: [{ content: [{ text: "hi", type: "text" }], role: "user", timestamp: 0 }],
        systemPrompt: "",
        tools: [],
      });
      const stream = streamOpenAIResponses(model, context, { apiKey: "test" });
      const events: typesModule.AssistantMessageEvent[] = [];
      let initialStopReason: typesModule.AssistantMessage["stopReason"] | undefined;

      yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === "start") initialStopReason = event.partial.stopReason;
            events.push(event);
          }),
        ),
      );

      const result = yield* Effect.promise(() => stream.result());
      const lastEvent = events.at(-1);
      expect(initialStopReason).toBe("pending");
      expect(lastEvent?.type).toBe("error");
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toBe(
        "OpenAI Responses stream ended before a terminal response event",
      );
    }),
  );

describe("OpenAI Responses terminal event handling", () => {
  it(
    "emits an error final result when the wrapper stream ends before a terminal response event",
    emitsAnErrorFinalResultWhen,
  );
});
