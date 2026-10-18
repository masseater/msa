import { Effect } from "effect";

import type { Model, Tool } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { callHook } from "../utils/hooks.ts";
import type { TranscriptContext } from "../utils/transcript.ts";
import type { AnthropicOptions } from "./anthropic-messages-options.ts";
import { performRequest } from "./anthropic-messages-request.ts";
import { createStreamState, runStreamEvents } from "./anthropic-messages-run-stream.ts";
import {
  createOutput,
  failStream,
  finalizeStream,
  resolveClient,
  type RunState,
} from "./anthropic-messages-run.ts";

interface RunAnthropicRequestInput {
  readonly model: Model<"anthropic-messages">;
  readonly context: TranscriptContext;
  readonly options: AnthropicOptions | undefined;
  readonly events: AssistantMessageEventStream;
  readonly currentTools: ReadonlyArray<Tool>;
}

function runAnthropicRequest(input: RunAnthropicRequestInput): Effect.Effect<void> {
  const { model, context, options, events, currentTools } = input;
  return Effect.gen(function* () {
    const output = createOutput(model);
    yield* Effect.gen(function* () {
      const { client, isOAuth } = resolveClient({ model, options });
      const run: RunState = { model, output, options, events, client };
      const response = yield* performRequest({ run, context, isOAuth });
      yield* callHook(() =>
        options?.onResponse?.(
          { status: response.status, headers: headersToRecord(response.headers) },
          model,
        ),
      );
      events.push({ type: "start", partial: output });
      const streamState = createStreamState({ events, model, output, isOAuth, currentTools });
      yield* runStreamEvents({ run, response, state: streamState });
      finalizeStream({
        output: streamState.output,
        events: streamState.events,
        inputTransformations: streamState.inputTransformations,
        signal: options?.signal,
      });
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => failStream({ output, events, error, signal: options?.signal })),
      ),
    );
  });
}

export { runAnthropicRequest };
