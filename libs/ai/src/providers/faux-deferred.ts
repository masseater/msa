import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import hooks from "../utils/hooks.ts";
import type fauxDeferredTypes from "./faux-deferred.types.ts";
import fauxEngine from "./faux-engine.ts";
import type fauxEngineTypes from "./faux-engine.types.ts";
import fauxMessages from "./faux-messages.ts";
import fauxStream from "./faux-stream.ts";

const { deferredMessage, errorMessage, randomId } = fauxMessages;
const { streamFauxMessage } = fauxStream;
const { originOf, resolveFauxResponse, streamDetached } = fauxEngine;
const { callHook } = hooks;

function submitDeferred({
  engine,
  stream,
  step,
  context,
  options,
  model,
}: fauxDeferredTypes.DeferredSubmission): Effect.Effect<void> {
  const pollAfterMs = engine.deferred?.pollAfterMs;
  const handle: typesModule.DeferredHandle = {
    api: model.api,
    id: randomId("deferred"),
    modelId: model.id,
    provider: model.provider,
    ...(pollAfterMs === undefined ? {} : { pollAfterMs }),
  };
  engine.deferredResponses.set(handle.id, {
    cancelled: false,
    context,
    handle,
    model,
    options,
    pendingFetches: Math.max(0, Math.floor(engine.deferred?.pendingFetches ?? 0)),
    step,
  });
  return streamFauxMessage({
    message: deferredMessage({ handle, model }),
    pacing: engine.pacing,
    signal: options.signal,
    stream,
  });
}

function findEntry(
  engine: fauxEngineTypes.FauxEngine,
  handle: typesModule.DeferredHandle,
): fauxEngineTypes.DeferredEntry {
  const entry = engine.deferredResponses.get(handle.id);
  if (
    entry === undefined ||
    entry.handle.provider !== handle.provider ||
    entry.handle.modelId !== handle.modelId ||
    entry.handle.api !== handle.api
  ) {
    throw new Error(`Unknown faux deferred response: ${handle.id}`);
  }
  if (entry.cancelled) throw new Error(`Faux deferred response was cancelled: ${handle.id}`);
  return entry;
}

const settleEntry = Effect.fn("settleEntry")(function* (
  engine: fauxEngineTypes.FauxEngine,
  entry: fauxEngineTypes.DeferredEntry,
) {
  if (entry.final !== undefined) return entry.final;
  const {
    deferred: _deferred,
    signal: _submissionSignal,
    onResponse: _submissionOnResponse,
    ...submissionOptions
  } = entry.options ?? {};
  const final = yield* resolveFauxResponse({
    context: entry.context,
    engine,
    model: entry.model,
    options: submissionOptions,
    step: entry.step,
  }).pipe(
    Effect.catchDefect((error) =>
      Effect.succeed(errorMessage({ error, origin: originOf(engine)(entry.model) })),
    ),
  );
  entry.final = final;
  return final;
});

function fetchDeferred({
  engine,
  model,
  handle,
  options,
}: fauxDeferredTypes.DeferredFetch): typesModule.AssistantMessageEventStream {
  engine.state.deferredFetchCount++;
  return streamDetached({
    engine,
    model,
    run: (stream) =>
      Effect.gen(function* () {
        yield* callHook(() => options?.onResponse?.({ headers: {}, status: 200 }, model));
        const entry = findEntry(engine, handle);
        const delivery = { pacing: engine.pacing, signal: options?.signal, stream };
        if (entry.pendingFetches > 0) {
          entry.pendingFetches--;
          return yield* streamFauxMessage({
            ...delivery,
            message: deferredMessage({ handle: entry.handle, model }),
          });
        }
        yield* streamFauxMessage({ ...delivery, message: yield* settleEntry(engine, entry) });
      }),
  });
}

function cancelDeferred({
  engine,
  model,
  handle,
  options,
}: fauxDeferredTypes.DeferredCancel): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      engine.state.cancelledDeferred.push(structuredClone(handle));
      const entry = engine.deferredResponses.get(handle.id);
      if (entry !== undefined) entry.cancelled = true;
      yield* callHook(() => options?.onResponse?.({ headers: {}, status: 200 }, model));
    }),
  );
}

const fauxDeferred = {
  cancelDeferred,
  fetchDeferred,
  submitDeferred,
};

export default fauxDeferred;
