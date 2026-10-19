import { Effect, Stream } from "effect";

import type { AssistantMessage, Model } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { callHook } from "../utils/hooks.ts";
import { dispatchEvent, type StreamState } from "./anthropic-messages-events.ts";
import type { RunState } from "./anthropic-messages-run.ts";
import { iterateAnthropicEvents } from "./anthropic-sse.ts";

interface CreateStreamStateInput {
  readonly events: AssistantMessageEventStream;
  readonly model: Model<"anthropic-messages">;
  readonly output: AssistantMessage;
}

function createStreamState(input: CreateStreamStateInput): StreamState {
  return {
    events: input.events,
    model: input.model,
    output: input.output,
    usageModel: input.model,
    inputTransformations: undefined,
  };
}

interface RunStreamEventsInput {
  readonly run: RunState;
  readonly response: Response;
  readonly state: StreamState;
}

function runStreamEvents(input: RunStreamEventsInput): Effect.Effect<void> {
  const { run, response, state } = input;
  const options = run.options;
  return iterateAnthropicEvents({ response, signal: options?.signal }).pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        yield* callHook(() => options?.onProviderStreamEvent?.(event, run.model));
        yield* Effect.sync(() => dispatchEvent({ state, event }));
      }),
    ),
  );
}

export { createStreamState, runStreamEvents };
