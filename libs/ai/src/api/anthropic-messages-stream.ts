import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import type transcriptTypes from "../utils/transcript.types.ts";
import type anthropicMessagesOptionsTypes from "./anthropic-messages-options.ts";
import anthropicMessagesRequest from "./anthropic-messages-request.ts";
import anthropicMessagesRunStream from "./anthropic-messages-run-stream.ts";
import anthropicMessagesRun from "./anthropic-messages-run.ts";
import type anthropicMessagesRunTypes from "./anthropic-messages-run.types.ts";
import anthropicMessagesStreamKit from "./anthropic-messages-stream-kit.ts";

const { headers: headersModule, hooks } = anthropicMessagesStreamKit;

const { createOutput, failStream, finalizeStream, resolveClient } = anthropicMessagesRun;
const { performRequest } = anthropicMessagesRequest;
const { callHook } = hooks;
const { headersToRecord } = headersModule;
const { createStreamState, runStreamEvents } = anthropicMessagesRunStream;

interface RunAnthropicRequestInput {
  readonly model: typesModule.Model<"anthropic-messages">;
  readonly context: transcriptTypes.TranscriptContext;
  readonly options: anthropicMessagesOptionsTypes.AnthropicOptions | undefined;
  readonly events: eventStreamTypes.AssistantMessageEventStream;
}

function runAnthropicRequest(input: RunAnthropicRequestInput): Effect.Effect<void> {
  const { model, context, options, events } = input;
  return Effect.gen(function* () {
    const output = createOutput(model);
    yield* Effect.gen(function* () {
      const client = resolveClient({ model, options });
      const run: anthropicMessagesRunTypes.RunState = { client, events, model, options, output };
      const response = yield* performRequest({ context, run });
      yield* callHook(() =>
        options?.onResponse?.(
          { headers: headersToRecord(response.headers), status: response.status },
          model,
        ),
      );
      events.push({ partial: output, type: "start" });
      const streamState = createStreamState({ events, model, output });
      yield* runStreamEvents({ response, run, state: streamState });
      finalizeStream({
        events: streamState.events,
        inputTransformations: streamState.inputTransformations,
        output: streamState.output,
        signal: options?.signal,
      });
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => failStream({ error, events, output, signal: options?.signal })),
      ),
    );
  });
}

const anthropicMessagesStream = {
  runAnthropicRequest,
};

export default anthropicMessagesStream;
