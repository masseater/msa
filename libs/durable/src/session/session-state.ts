import { Effect, Function } from "effect";

import clockModule from "../clock.ts";
import type dualTypes from "../dual.ts";
import errors from "../errors.ts";
import type typesModule from "../types.types.ts";
import type sessionStateTypes from "./session-state.types.ts";

const { currentTimeMillis } = clockModule;
const { SessionFailed } = errors;

let defaultRetention = 600_000;

const setDefaultDocumentRetention = (ms: number): void => {
  defaultRetention = ms;
};

const documentRetention = (ms: number | undefined): number =>
  typeof ms === "number" && ms >= 0 ? ms : defaultRetention;

const guardedClock = (now: () => number) => (): number => {
  try {
    return now();
  } catch {
    return currentTimeMillis();
  }
};

const guardedRetention = (retention: () => number | undefined) => (): number => {
  try {
    return documentRetention(retention());
  } catch {
    return documentRetention(undefined);
  }
};

const createSessionState = (init: {
  readonly hooks: sessionStateTypes.SessionHooks;
  readonly storage: typesModule.Storage;
  readonly now: () => number;
  readonly documentRetentionMs: () => number | undefined;
}): sessionStateTypes.SessionState => ({
  attachedDocuments: new Map(),
  clock: guardedClock(init.now),
  closeListeners: new Set(),
  closed: Promise.withResolvers<typesModule.SessionEnd>(),
  closing: undefined,
  commitListeners: new Set(),
  documentRetentionMs: guardedRetention(init.documentRetentionMs),
  documentSweep: undefined,
  documentTimersUnavailable: false,
  documents: new Map(),
  failed: Promise.withResolvers<never>(),
  failure: undefined,
  hooks: init.hooks,
  idleDocuments: new Map(),
  internalListeners: new Set(),
  now: init.now,
  storage: init.storage,
  sweepJobs: 0,
  tail: Promise.resolve(),
});

const assertHealthy = (state: sessionStateTypes.SessionState): void => {
  if (state.failure !== undefined) throw SessionFailed.create(state.failure.error);
};

const assertUsable = (state: sessionStateTypes.SessionState): void => {
  assertHealthy(state);
  if (state.closing !== undefined) throw new Error("Session is closed");
};

const enqueue: {
  <T>(job: () => Promise<T>): (state: sessionStateTypes.SessionState) => Promise<T>;
  <T>(state: sessionStateTypes.SessionState, job: () => Promise<T>): Promise<T>;
} = Function.dual(
  2,
  <T>(state: sessionStateTypes.SessionState, job: () => Promise<T>): Promise<T> => {
    const run = state.tail.then(job);
    state.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  },
);

const enqueueHealthy: {
  <T>(job: Effect.Effect<T>): (state: sessionStateTypes.SessionState) => Promise<T>;
  <T>(state: sessionStateTypes.SessionState, job: Effect.Effect<T>): Promise<T>;
} = Function.dual(
  2,
  <T>(state: sessionStateTypes.SessionState, job: Effect.Effect<T>): Promise<T> =>
    enqueue(state, () =>
      Effect.runPromise(
        Effect.suspend(() => {
          assertHealthy(state);
          return job;
        }),
      ),
    ),
);

const addListener: {
  <L>(listener: L): (listeners: Set<L>) => () => void;
  <L>(listeners: Set<L>, listener: L): () => void;
} = Function.dual(2, <L>(listeners: Set<L>, listener: L): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});

const contained: dualTypes.Dual2<() => unknown, (error: unknown) => void, void> = Function.dual(
  2,
  (callback: () => unknown, onError: (error: unknown) => void): void => {
    try {
      const result = callback();
      if (typeof (result as { then?: unknown } | null)?.then === "function")
        Promise.resolve(result).catch(onError);
    } catch (error) {
      onError(error);
    }
  },
);

const readOnLine: {
  <T>(job: () => Promise<T>): (state: sessionStateTypes.SessionState) => Promise<T>;
  <T>(state: sessionStateTypes.SessionState, job: () => Promise<T>): Promise<T>;
} = Function.dual(
  2,
  <T>(state: sessionStateTypes.SessionState, job: () => Promise<T>): Promise<T> => {
    try {
      assertUsable(state);
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueHealthy(state, Effect.promise(job));
  },
);

const unloadDocuments = (state: sessionStateTypes.SessionState): Promise<void> =>
  enqueue(state, () =>
    Effect.runPromise(
      Effect.sync(() => {
        state.documents.clear();
        state.idleDocuments.clear();
      }),
    ),
  );

const documentCacheSizes = (
  state: sessionStateTypes.SessionState,
): sessionStateTypes.DocumentCacheSizes => ({
  attached: state.attachedDocuments.size,
  cached: state.documents.size,
  idle: state.idleDocuments.size,
  sweeps: state.sweepJobs,
});

const sessionState = {
  addListener,
  assertHealthy,
  assertUsable,
  contained,
  createSessionState,
  currentTimeMillis: clockModule.currentTimeMillis,
  documentCacheSizes,
  documentRetention,
  enqueue,
  enqueueHealthy,
  readOnLine,
  setDefaultDocumentRetention,
  unloadDocuments,
};

export default sessionState;
