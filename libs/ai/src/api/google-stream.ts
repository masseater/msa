import type { GenerateContentParameters, GoogleGenAI } from "@google/genai";
import { Effect, Stream } from "effect";

import type { Model, TranscriptContext } from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { callHook } from "../utils/hooks.ts";
import { collapseSystemMessages } from "../utils/transcript.ts";
import { buildGoogleParams, type GoogleRequestOptions } from "./google-params.ts";
import { retryGoogleRequest } from "./google-shared.ts";
import {
  closeCurrentBlock,
  createGoogleStreamState,
  failGoogleStream,
  googleChunkHandler,
  type GoogleStreamState,
} from "./google-stream-events.ts";
import type { GoogleApiType } from "./google-thinking.ts";

export interface GoogleStreamSpec<T extends GoogleApiType, O extends GoogleRequestOptions> {
  readonly model: Model<T>;
  readonly context: TranscriptContext;
  readonly options: O | undefined;
  readonly adapterName: string;
  readonly streamName: string;
  readonly createClient: (options: O | undefined) => GoogleGenAI;
}

function finishStream<T extends GoogleApiType>(
  state: GoogleStreamState<T>,
  streamName: string,
  signal: AbortSignal | undefined,
): void {
  const { output, events } = state;
  closeCurrentBlock(state);
  if (signal?.aborted === true) throw new Error("Request was aborted");
  if (output.stopReason === "pending") {
    throw new Error(`${streamName} stream ended without a finish reason`);
  }
  if (output.stopReason === "aborted" || output.stopReason === "error") {
    throw new Error(
      output.rawStopReason !== undefined && output.rawStopReason !== ""
        ? `Provider stopped with: ${output.rawStopReason}`
        : "An unknown error occurred",
    );
  }
  events.push({ type: "done", reason: output.stopReason, message: output });
  events.end();
}

const runGoogleRequest = Effect.fn("runGoogleRequest")(function* <
  T extends GoogleApiType,
  O extends GoogleRequestOptions,
>(spec: GoogleStreamSpec<T, O>, state: GoogleStreamState<T>) {
  const { model, options } = spec;
  if (options?.fetch !== undefined && options.fetch !== globalThis.fetch) {
    throw new Error(`Custom fetch is not supported by the ${spec.adapterName} adapter`);
  }
  const client = spec.createClient(options);
  let params = buildGoogleParams({ model, context: spec.context, options });
  const nextParams = yield* callHook(() => options?.onPayload?.(params, model));
  if (nextParams !== undefined) params = nextParams as GenerateContentParameters;
  const googleStream = yield* retryGoogleRequest(
    () => client.models.generateContentStream(params),
    options,
  );
  state.events.push({ type: "start", partial: state.output });
  const handleChunk = googleChunkHandler(state);
  yield* Stream.fromAsyncIterable(googleStream, (error) => error).pipe(
    Stream.orDie,
    Stream.runForEach((chunk) =>
      Effect.map(
        callHook(() => options?.onProviderStreamEvent?.(chunk, model)),
        () => handleChunk(chunk),
      ),
    ),
  );
  finishStream(state, spec.streamName, options?.signal);
});

export function runGoogleStream<T extends GoogleApiType, O extends GoogleRequestOptions>(
  spec: GoogleStreamSpec<T, O>,
): AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  const normalized = { ...spec, context: collapseSystemMessages(spec.context) };
  Effect.runFork(
    Effect.gen(function* () {
      const state = createGoogleStreamState({ model: spec.model, events });
      yield* runGoogleRequest(normalized, state).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => failGoogleStream({ state, error, signal: spec.options?.signal })),
        ),
      );
    }),
  );
  return events;
}
