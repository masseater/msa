import type { GenerateContentParameters } from "@google/genai";
import { Effect, Stream } from "effect";

import type eventStreamTypes from "../utils/event-stream.types.ts";
import type googleParamsTypes from "./google-params.types.ts";
import googleShared from "./google-shared.ts";
import googleStreamEvents from "./google-stream-events.ts";
import type googleStreamEventsTypes from "./google-stream-events.types.ts";
import googleStreamKit from "./google-stream-kit.ts";
import type googleStreamTypes from "./google-stream.types.ts";
import type googleThinkingTypes from "./google-thinking.types.ts";

const { eventStream, googleParams, hooks, transcript } = googleStreamKit;

const { closeCurrentBlock, createGoogleStreamState, failGoogleStream, googleChunkHandler } =
  googleStreamEvents;
const { buildGoogleParams } = googleParams;
const { callHook } = hooks;
const { retryGoogleRequest } = googleShared;
const { AssistantMessageEventStream } = eventStream;
const { collapseSystemMessages } = transcript;

function finishStream<T extends googleThinkingTypes.GoogleApiType>(
  state: googleStreamEventsTypes.GoogleStreamState<T>,
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
  events.push({ message: output, reason: output.stopReason, type: "done" });
  events.end();
}

const runGoogleRequest = Effect.fn("runGoogleRequest")(function* <
  T extends googleThinkingTypes.GoogleApiType,
  O extends googleParamsTypes.GoogleRequestOptions,
>(
  spec: googleStreamTypes.GoogleStreamSpec<T, O>,
  state: googleStreamEventsTypes.GoogleStreamState<T>,
) {
  const { model, options } = spec;
  if (options?.fetch !== undefined && options.fetch !== globalThis.fetch) {
    throw new Error(`Custom fetch is not supported by the ${spec.adapterName} adapter`);
  }
  const client = spec.createClient(options);
  let params = buildGoogleParams({ context: spec.context, model, options });
  const nextParams = yield* callHook(() => options?.onPayload?.(params, model));
  if (nextParams !== undefined) params = nextParams as GenerateContentParameters;
  const googleStream = yield* retryGoogleRequest(
    () => client.models.generateContentStream(params),
    options,
  );
  state.events.push({ partial: state.output, type: "start" });
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

function runGoogleStream<
  T extends googleThinkingTypes.GoogleApiType,
  O extends googleParamsTypes.GoogleRequestOptions,
>(spec: googleStreamTypes.GoogleStreamSpec<T, O>): eventStreamTypes.AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  const normalized = { ...spec, context: collapseSystemMessages(spec.context) };
  Effect.runFork(
    Effect.gen(function* () {
      const state = createGoogleStreamState({ events, model: spec.model });
      yield* runGoogleRequest(normalized, state).pipe(
        Effect.catchDefect((error) =>
          Effect.sync(() => failGoogleStream({ error, signal: spec.options?.signal, state })),
        ),
      );
    }),
  );
  return events;
}

const googleStreamModule = {
  runGoogleStream,
};

export default googleStreamModule;
