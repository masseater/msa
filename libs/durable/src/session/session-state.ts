import type { Context } from "@msa/chord";
import { Clock, Context as EffectContext, Effect, Function } from "effect";

import type { Dual2 } from "../dual.ts";
import { SessionFailed } from "../errors.ts";
import type {
  CommitPublication,
  ConversationRecord,
  DocumentId,
  SessionEnd,
  Storage,
} from "../types.ts";
import type { LoadedDocument } from "./transaction-types.ts";
import type { Transaction } from "./transaction.ts";

export type CommitListener = (publication: CommitPublication, context: Context) => void;

export type SessionHooks = {
  report(error: unknown): void;
  fail(error: unknown): void;
  conversationCreated(tx: Transaction, record: ConversationRecord): Promise<void>;
  beforeClose(): Promise<void>;
};

export type DocumentSweep = {
  readonly at: number;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export type SessionState = {
  readonly hooks: SessionHooks;
  readonly storage: Storage;
  readonly now: () => number;
  readonly clock: () => number;
  readonly documentRetentionMs: () => number;
  readonly documents: Map<string, LoadedDocument>;
  readonly idleDocuments: Map<string, number>;
  readonly attachedDocuments: Map<DocumentId, number>;
  documentSweep: DocumentSweep | undefined;
  sweepJobs: number;
  documentTimersUnavailable: boolean;
  readonly commitListeners: Set<CommitListener>;
  readonly internalListeners: Set<CommitListener>;
  readonly closeListeners: Set<() => void>;
  tail: Promise<void>;
  closing: Promise<void> | undefined;
  failure: { readonly error: unknown } | undefined;
  readonly failed: PromiseWithResolvers<never>;
  readonly closed: PromiseWithResolvers<SessionEnd>;
};

let defaultRetention = 600_000;

export const setDefaultDocumentRetention = (ms: number): void => {
  defaultRetention = ms;
};

export const documentRetention = (ms: number | undefined): number =>
  typeof ms === "number" && ms >= 0 ? ms : defaultRetention;

const clock = EffectContext.get(EffectContext.empty(), Clock.Clock);

export const currentTimeMillis = (): number => clock.currentTimeMillisUnsafe();

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

export const createSessionState = (init: {
  readonly hooks: SessionHooks;
  readonly storage: Storage;
  readonly now: () => number;
  readonly documentRetentionMs: () => number | undefined;
}): SessionState => ({
  hooks: init.hooks,
  storage: init.storage,
  now: init.now,
  clock: guardedClock(init.now),
  documentRetentionMs: guardedRetention(init.documentRetentionMs),
  documents: new Map(),
  idleDocuments: new Map(),
  attachedDocuments: new Map(),
  documentSweep: undefined,
  sweepJobs: 0,
  documentTimersUnavailable: false,
  commitListeners: new Set(),
  internalListeners: new Set(),
  closeListeners: new Set(),
  tail: Promise.resolve(),
  closing: undefined,
  failure: undefined,
  failed: Promise.withResolvers<never>(),
  closed: Promise.withResolvers<SessionEnd>(),
});

export const assertHealthy = (state: SessionState): void => {
  if (state.failure !== undefined) throw new SessionFailed(state.failure.error);
};

export const assertUsable = (state: SessionState): void => {
  assertHealthy(state);
  if (state.closing !== undefined) throw new Error("Session is closed");
};

export const enqueue: {
  <T>(job: () => Promise<T>): (state: SessionState) => Promise<T>;
  <T>(state: SessionState, job: () => Promise<T>): Promise<T>;
} = Function.dual(2, <T>(state: SessionState, job: () => Promise<T>): Promise<T> => {
  const run = state.tail.then(job);
  state.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
});

export const enqueueHealthy: {
  <T>(job: Effect.Effect<T>): (state: SessionState) => Promise<T>;
  <T>(state: SessionState, job: Effect.Effect<T>): Promise<T>;
} = Function.dual(2, <T>(state: SessionState, job: Effect.Effect<T>): Promise<T> =>
  enqueue(state, () =>
    Effect.runPromise(
      Effect.suspend(() => {
        assertHealthy(state);
        return job;
      }),
    ),
  ),
);

export const addListener: {
  <L>(listener: L): (listeners: Set<L>) => () => void;
  <L>(listeners: Set<L>, listener: L): () => void;
} = Function.dual(2, <L>(listeners: Set<L>, listener: L): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});

export const contained: Dual2<() => unknown, (error: unknown) => void, void> = Function.dual(
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

export const readOnLine: {
  <T>(job: () => Promise<T>): (state: SessionState) => Promise<T>;
  <T>(state: SessionState, job: () => Promise<T>): Promise<T>;
} = Function.dual(2, <T>(state: SessionState, job: () => Promise<T>): Promise<T> => {
  try {
    assertUsable(state);
  } catch (error) {
    return Promise.reject(error);
  }
  return enqueueHealthy(state, Effect.promise(job));
});

export const unloadDocuments = (state: SessionState): Promise<void> =>
  enqueue(state, () =>
    Effect.runPromise(
      Effect.sync(() => {
        state.documents.clear();
        state.idleDocuments.clear();
      }),
    ),
  );

export type DocumentCacheSizes = {
  readonly cached: number;
  readonly idle: number;
  readonly attached: number;
  readonly sweeps: number;
};

export const documentCacheSizes = (state: SessionState): DocumentCacheSizes => ({
  cached: state.documents.size,
  idle: state.idleDocuments.size,
  attached: state.attachedDocuments.size,
  sweeps: state.sweepJobs,
});
