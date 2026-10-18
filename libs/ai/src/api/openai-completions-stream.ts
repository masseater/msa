import { Effect, Stream } from "effect";

import { headersToRecord } from "../utils/headers.ts";
import { callHook } from "../utils/hooks.ts";
import { getCompat, resolveCacheRetention } from "./openai-completions-compat.ts";
import { createRequestStream } from "./openai-completions-request.ts";
import { processChunk } from "./openai-completions-stream-chunk.ts";
import {
  failCompletionsStream,
  finalizeCompletionsStream,
} from "./openai-completions-stream-finalize.ts";
import { createCompletionsStreamState } from "./openai-completions-stream-state.ts";

type RequestInput = Parameters<typeof createRequestStream>[0];
type StateInput = Parameters<typeof createCompletionsStreamState>[0];

interface RunCompletionsStreamInput {
  readonly model: RequestInput["model"];
  readonly context: RequestInput["context"];
  readonly options: RequestInput["options"];
  readonly events: StateInput["events"];
}

function runCompletionsStream(input: RunCompletionsStreamInput): Effect.Effect<void> {
  const { model, context, options, events } = input;
  const compat = getCompat(model);
  const state = createCompletionsStreamState({ events, model, context, options, compat });
  const output = state.output;
  return Effect.gen(function* () {
    const { data: openaiStream, response } = yield* createRequestStream({
      model,
      context,
      options,
      compat,
      cacheRetention: resolveCacheRetention({
        cacheRetention: options?.cacheRetention,
        env: options?.env,
      }),
      grammarToolInputProperties: state.grammarToolInputProperties,
    });
    yield* callHook(() =>
      options?.onResponse?.(
        { status: response.status, headers: headersToRecord(response.headers) },
        model,
      ),
    );
    events.push({ type: "start", partial: output });
    yield* Stream.fromAsyncIterable(openaiStream, (error) => error).pipe(
      Stream.orDie,
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          yield* callHook(() => options?.onProviderStreamEvent?.(chunk, model));
          yield* Effect.sync(() => processChunk({ state, chunk }));
        }),
      ),
    );
    yield* Effect.sync(() => finalizeCompletionsStream(state));
  }).pipe(
    Effect.catchDefect((error) =>
      Effect.sync(() => failCompletionsStream({ output, events, error, signal: options?.signal })),
    ),
  );
}

export { runCompletionsStream };
