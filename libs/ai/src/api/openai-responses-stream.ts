import { Effect, Function, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import openaiResponsesEvents from "./openai-responses-events.ts";
import type openaiResponsesOptionsTypes from "./openai-responses-options.ts";
import type openaiResponsesStreamStateTypes from "./openai-responses-stream-state.types.ts";

const { handleResponsesEvent } = openaiResponsesEvents;

type ResponsesEvents = AsyncIterable<ResponseStreamEvent> | Stream.Stream<ResponseStreamEvent>;

function assertFinished<TApi extends typesModule.Api>(
  state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi>,
): void {
  if (!state.sawTerminalResponseEvent) {
    throw new Error("OpenAI Responses stream ended before a terminal response event");
  }
  if (state.output.stopReason !== "toolUse") return;
  const unfinished = state.output.content.find(
    (block): block is openaiResponsesStreamStateTypes.StreamingToolCall =>
      block.type === "toolCall" &&
      ((block as openaiResponsesStreamStateTypes.StreamingToolCall).partialJson !== undefined ||
        (block as openaiResponsesStreamStateTypes.StreamingToolCall).customInput !== undefined),
  );
  if (unfinished === undefined) return;
  throw new Error(
    `OpenAI Responses stream completed with an unfinished tool call: ${unfinished.name} (${unfinished.id})`,
  );
}

function runResponsesStream<TApi extends typesModule.Api>(
  openaiStream: ResponsesEvents,
  output: typesModule.AssistantMessage,
  stream: eventStreamTypes.AssistantMessageEventStream,
  model: typesModule.Model<TApi>,
  options?: openaiResponsesOptionsTypes.OpenAIResponsesStreamOptions,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    const state: openaiResponsesStreamStateTypes.ResponsesStreamState<TApi> = {
      model,
      options,
      output,
      reasoningBlocksById: new Map(),
      sawTerminalResponseEvent: false,
      slots: new Map(),
      stream,
    };
    const handleEvent = handleResponsesEvent(state);
    const events = Stream.isStream(openaiStream)
      ? openaiStream
      : Stream.fromAsyncIterable(openaiStream, (error) => error).pipe(Stream.orDie);
    return events.pipe(
      Stream.runForEach((event) =>
        Effect.promise(() => Promise.resolve(options?.onProviderStreamEvent?.(event, model))).pipe(
          Effect.andThen(Effect.sync(() => handleEvent(event))),
        ),
      ),
      Effect.andThen(Effect.sync(() => assertFinished(state))),
    );
  });
}

const processResponsesStream: {
  <TApi extends typesModule.Api>(
    output: typesModule.AssistantMessage,
    stream: eventStreamTypes.AssistantMessageEventStream,
    model: typesModule.Model<TApi>,
    options?: openaiResponsesOptionsTypes.OpenAIResponsesStreamOptions,
  ): (openaiStream: ResponsesEvents) => Effect.Effect<void>;
  <TApi extends typesModule.Api>(
    openaiStream: ResponsesEvents,
    output: typesModule.AssistantMessage,
    stream: eventStreamTypes.AssistantMessageEventStream,
    model: typesModule.Model<TApi>,
    options?: openaiResponsesOptionsTypes.OpenAIResponsesStreamOptions,
  ): Effect.Effect<void>;
} = Function.dual(
  (args) => typeof args[3] === "object" && args[3] !== null && "api" in args[3],
  runResponsesStream,
);

const openaiResponsesStream = {
  processResponsesStream,
};

export default openaiResponsesStream;
