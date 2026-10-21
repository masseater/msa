import { Effect, Stream } from "effect";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import hooks from "../utils/hooks.ts";
import anthropicMessagesEvents from "./anthropic-messages-events.ts";
import type anthropicMessagesEventsTypes from "./anthropic-messages-events.types.ts";
import type anthropicMessagesRunTypes from "./anthropic-messages-run.types.ts";
import anthropicSse from "./anthropic-sse.ts";

const { iterateAnthropicEvents } = anthropicSse;
const { callHook } = hooks;
const { dispatchEvent } = anthropicMessagesEvents;

interface CreateStreamStateInput {
  readonly events: eventStreamTypes.AssistantMessageEventStream;
  readonly model: typesModule.Model<"anthropic-messages">;
  readonly output: typesModule.AssistantMessage;
}

function createStreamState(
  input: CreateStreamStateInput,
): anthropicMessagesEventsTypes.StreamState {
  return {
    events: input.events,
    inputTransformations: undefined,
    model: input.model,
    output: input.output,
    usageModel: input.model,
  };
}

interface RunStreamEventsInput {
  readonly run: anthropicMessagesRunTypes.RunState;
  readonly response: Response;
  readonly state: anthropicMessagesEventsTypes.StreamState;
}

function runStreamEvents(input: RunStreamEventsInput): Effect.Effect<void> {
  const { run, response, state } = input;
  const options = run.options;
  return iterateAnthropicEvents({ response, signal: options?.signal }).pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        yield* callHook(() => options?.onProviderStreamEvent?.(event, run.model));
        yield* Effect.sync(() => dispatchEvent({ event, state }));
      }),
    ),
  );
}

const anthropicMessagesRunStream = {
  createStreamState,
  runStreamEvents,
};

export default anthropicMessagesRunStream;
