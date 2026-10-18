import { Effect, Function, Stream } from "effect";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";

import type { Api, AssistantMessage, Model } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { handleResponsesEvent } from "./openai-responses-events.ts";
import type { OpenAIResponsesStreamOptions } from "./openai-responses-options.ts";
import type { ResponsesStreamState, StreamingToolCall } from "./openai-responses-stream-state.ts";

type ResponsesEvents = AsyncIterable<ResponseStreamEvent> | Stream.Stream<ResponseStreamEvent>;

function assertFinished<TApi extends Api>(state: ResponsesStreamState<TApi>): void {
  if (!state.sawTerminalResponseEvent) {
    throw new Error("OpenAI Responses stream ended before a terminal response event");
  }
  if (state.output.stopReason !== "toolUse") return;
  const unfinished = state.output.content.find(
    (block): block is StreamingToolCall =>
      block.type === "toolCall" &&
      ((block as StreamingToolCall).partialJson !== undefined ||
        (block as StreamingToolCall).customInput !== undefined),
  );
  if (unfinished === undefined) return;
  throw new Error(
    `OpenAI Responses stream completed with an unfinished tool call: ${unfinished.name} (${unfinished.id})`,
  );
}

function runResponsesStream<TApi extends Api>(
  openaiStream: ResponsesEvents,
  output: AssistantMessage,
  stream: AssistantMessageEventStream,
  model: Model<TApi>,
  options?: OpenAIResponsesStreamOptions,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    const state: ResponsesStreamState<TApi> = {
      output,
      stream,
      model,
      options,
      slots: new Map(),
      reasoningBlocksById: new Map(),
      sawTerminalResponseEvent: false,
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

export const processResponsesStream: {
  <TApi extends Api>(
    output: AssistantMessage,
    stream: AssistantMessageEventStream,
    model: Model<TApi>,
    options?: OpenAIResponsesStreamOptions,
  ): (openaiStream: ResponsesEvents) => Effect.Effect<void>;
  <TApi extends Api>(
    openaiStream: ResponsesEvents,
    output: AssistantMessage,
    stream: AssistantMessageEventStream,
    model: Model<TApi>,
    options?: OpenAIResponsesStreamOptions,
  ): Effect.Effect<void>;
} = Function.dual(
  (args) => typeof args[3] === "object" && args[3] !== null && "api" in args[3],
  runResponsesStream,
);
