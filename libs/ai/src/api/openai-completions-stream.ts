import { Effect, Stream } from "effect";

import headersModule from "../utils/headers.ts";
import hooks from "../utils/hooks.ts";
import openaiCompletionsCompat from "./openai-completions-compat.ts";
import openaiCompletionsOllama from "./openai-completions-ollama.ts";
import openaiCompletionsRequest from "./openai-completions-request.ts";
import openaiCompletionsStreamChunk from "./openai-completions-stream-chunk.ts";
import openaiCompletionsStreamFinalize from "./openai-completions-stream-finalize.ts";
import openaiCompletionsStreamState from "./openai-completions-stream-state.ts";

const { createRequestStream } = openaiCompletionsRequest;
const { createCompletionsStreamState } = openaiCompletionsStreamState;
const { getCompat, resolveCacheRetention } = openaiCompletionsCompat;
const { callHook } = hooks;
const { headersToRecord } = headersModule;
const { processChunk } = openaiCompletionsStreamChunk;
const { learnFromChunk } = openaiCompletionsOllama;
const { failCompletionsStream, finalizeCompletionsStream } = openaiCompletionsStreamFinalize;

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
  const state = createCompletionsStreamState({ compat, context, events, model, options });
  const output = state.output;
  return Effect.gen(function* () {
    const { data: openaiStream, response } = yield* createRequestStream({
      cacheRetention: resolveCacheRetention({
        cacheRetention: options?.cacheRetention,
        env: options?.env,
      }),
      compat,
      context,
      grammarToolInputProperties: state.grammarToolInputProperties,
      model,
      options,
    });
    yield* callHook(() =>
      options?.onResponse?.(
        { headers: headersToRecord(response.headers), status: response.status },
        model,
      ),
    );
    events.push({ partial: output, type: "start" });
    let learned = false;
    yield* Stream.fromAsyncIterable(openaiStream, (error) => error).pipe(
      Stream.orDie,
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          if (!learned) {
            learned = true;
            learnFromChunk({ chunk, compat, model });
          }
          yield* callHook(() => options?.onProviderStreamEvent?.(chunk, model));
          yield* Effect.sync(() => processChunk({ chunk, state }));
        }),
      ),
    );
    yield* Effect.sync(() => finalizeCompletionsStream(state));
  }).pipe(
    Effect.catchDefect((error) =>
      Effect.sync(() => failCompletionsStream({ error, events, output, signal: options?.signal })),
    ),
  );
}

const openaiCompletionsStream = {
  runCompletionsStream,
};

export default openaiCompletionsStream;
