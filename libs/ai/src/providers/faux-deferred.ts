import { Effect } from "effect";

import type {
  AssistantMessageEventStream,
  DeferredCancelOptions,
  DeferredFetchOptions,
  DeferredHandle,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from "../types.ts";
import { callHook } from "../utils/hooks.ts";
import {
  type DeferredEntry,
  type FauxEngine,
  originOf,
  resolveFauxResponse,
  streamDetached,
} from "./faux-engine.ts";
import { deferredMessage, errorMessage, randomId } from "./faux-messages.ts";
import { streamFauxMessage } from "./faux-stream.ts";
import type { FauxResponseStep } from "./faux-types.ts";

export interface DeferredSubmission {
  readonly engine: FauxEngine;
  readonly stream: AssistantMessageEventStream;
  readonly step: FauxResponseStep;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions;
  readonly model: Model<string>;
}

export function submitDeferred({
  engine,
  stream,
  step,
  context,
  options,
  model,
}: DeferredSubmission): Effect.Effect<void> {
  const pollAfterMs = engine.deferred?.pollAfterMs;
  const handle: DeferredHandle = {
    provider: model.provider,
    modelId: model.id,
    api: model.api,
    id: randomId("deferred"),
    ...(pollAfterMs === undefined ? {} : { pollAfterMs }),
  };
  engine.deferredResponses.set(handle.id, {
    handle,
    step,
    context,
    options,
    model,
    pendingFetches: Math.max(0, Math.floor(engine.deferred?.pendingFetches ?? 0)),
    cancelled: false,
  });
  return streamFauxMessage({
    stream,
    message: deferredMessage({ model, handle }),
    pacing: engine.pacing,
    signal: options.signal,
  });
}

function findEntry(engine: FauxEngine, handle: DeferredHandle): DeferredEntry {
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

const settleEntry = Effect.fn("settleEntry")(function* (engine: FauxEngine, entry: DeferredEntry) {
  if (entry.final !== undefined) return entry.final;
  const {
    deferred: _deferred,
    signal: _submissionSignal,
    onResponse: _submissionOnResponse,
    ...submissionOptions
  } = entry.options ?? {};
  const final = yield* resolveFauxResponse({
    engine,
    step: entry.step,
    context: entry.context,
    options: submissionOptions,
    model: entry.model,
  }).pipe(
    Effect.catchDefect((error) =>
      Effect.succeed(errorMessage({ error, origin: originOf(engine)(entry.model) })),
    ),
  );
  entry.final = final;
  return final;
});

export interface DeferredFetch {
  readonly engine: FauxEngine;
  readonly model: Model<string>;
  readonly handle: DeferredHandle;
  readonly options: DeferredFetchOptions | undefined;
}

export function fetchDeferred({
  engine,
  model,
  handle,
  options,
}: DeferredFetch): AssistantMessageEventStream {
  engine.state.deferredFetchCount++;
  return streamDetached({
    engine,
    model,
    run: (stream) =>
      Effect.gen(function* () {
        yield* callHook(() => options?.onResponse?.({ status: 200, headers: {} }, model));
        const entry = findEntry(engine, handle);
        const delivery = { stream, pacing: engine.pacing, signal: options?.signal };
        if (entry.pendingFetches > 0) {
          entry.pendingFetches--;
          return yield* streamFauxMessage({
            ...delivery,
            message: deferredMessage({ model, handle: entry.handle }),
          });
        }
        yield* streamFauxMessage({ ...delivery, message: yield* settleEntry(engine, entry) });
      }),
  });
}

export interface DeferredCancel {
  readonly engine: FauxEngine;
  readonly model: Model<string>;
  readonly handle: DeferredHandle;
  readonly options: DeferredCancelOptions | undefined;
}

export function cancelDeferred({ engine, model, handle, options }: DeferredCancel): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      engine.state.cancelledDeferred.push(structuredClone(handle));
      const entry = engine.deferredResponses.get(handle.id);
      if (entry !== undefined) entry.cancelled = true;
      yield* callHook(() => options?.onResponse?.({ status: 200, headers: {} }, model));
    }),
  );
}
