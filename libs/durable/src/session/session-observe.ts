import { replicatedState } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import { Effect, Function } from "effect";

import type { Dual3 } from "../dual.ts";
import type { DocumentCommitChange, DocumentState, DocumentWatch, JsonObject } from "../types.ts";
import {
  CommittedStateSource,
  CommittedWatch,
  type ObservedDocumentValue,
  RETIREMENT_OPERATIONS,
} from "./observation.ts";
import { pinDocument } from "./session-documents.ts";
import {
  type AnyDocToken,
  checked,
  loadResolved,
  type Resolved,
  resolveRead,
} from "./session-reads.ts";
import { addListener, assertUsable, enqueueHealthy, type SessionState } from "./session-state.ts";
import type { LoadedDocument } from "./transaction-types.ts";

type DocumentChange = Extract<DocumentCommitChange, { readonly type: "document" }>;

const observedOperations = (
  observed: { version: number },
  change: DocumentChange,
): DocumentChange["ops"] => {
  if (change.value === null) return RETIREMENT_OPERATIONS;
  if (change.version === observed.version) return change.ops;
  observed.version = change.version!;
  return [["r", change.value]];
};

export const cancellationError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");

type Observer = CommittedStateSource | CommittedWatch;

const followCommits = (
  state: SessionState,
  loaded: LoadedDocument,
  observer: Observer,
  unpin: () => void,
): (() => void) => {
  const observed = { version: loaded.valueVersion };
  assertUsable(state);
  return addListener(state.internalListeners, (publication, context) => {
    for (const change of publication.changes) {
      if (change.type !== "document" || change.record.id !== loaded.record.id) continue;
      const frameContext =
        observer instanceof CommittedStateSource ? withoutAbortSignal(context) : context;
      const ops = observedOperations(observed, change);
      if (ops.length === 0) continue;
      if (change.value === null) unpin();
      observer.advance(change.value, ops, frameContext);
    }
  });
};

const followClose = (state: SessionState, observer: Observer): (() => void) => {
  assertUsable(state);
  const listener = (): void => observer.closeSession(state.failure);
  state.closeListeners.add(listener);
  return () => state.closeListeners.delete(listener);
};

const attachDocument = <O extends Observer>(
  state: SessionState,
  read: Resolved,
  loaded: LoadedDocument,
  create: (value: JsonObject, detach: () => void) => O,
): { observer: O; detach: () => void } => {
  checked(read, loaded);
  let unsubscribeCommit = (): void => {};
  let unsubscribeClose = (): void => {};
  const unpin = pinDocument(state, loaded.addressId, loaded.record.id);
  const detach = (): void => {
    unsubscribeCommit();
    unsubscribeClose();
    unpin();
  };
  let observer: O;
  try {
    observer = create(loaded.tracker.value, detach);
  } catch (error) {
    unpin();
    throw error;
  }
  unsubscribeCommit = followCommits(state, loaded, observer, unpin);
  unsubscribeClose = followClose(state, observer);
  return { observer, detach };
};

export const documentStateOf: Dual3<
  SessionState,
  AnyDocToken,
  readonly unknown[],
  Promise<DocumentState<JsonObject> | undefined>
> = Function.dual(
  3,
  (
    state: SessionState,
    token: AnyDocToken,
    args: readonly unknown[],
  ): Promise<DocumentState<JsonObject> | undefined> => {
    try {
      assertUsable(state);
      const read = resolveRead(token, args);
      const attach = Effect.fnUntraced(function* () {
        const loaded = yield* loadResolved(state, read);
        if (loaded === undefined) return undefined;
        const { observer: source, detach } = attachDocument(
          state,
          read,
          loaded,
          (value, release) => new CommittedStateSource<ObservedDocumentValue>(value, release),
        );
        return yield* Effect.sync(
          () =>
            replicatedState(source, {
              onError: (error) => state.hooks.report(error),
            }) as DocumentState<JsonObject>,
        ).pipe(Effect.onError(() => Effect.sync(detach)));
      });
      return enqueueHealthy(state, attach());
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

const attachWatch = (
  state: SessionState,
  read: Resolved,
  cancelled: () => AbortSignal | undefined,
) =>
  Effect.gen(function* () {
    const before = cancelled();
    if (before !== undefined) throw cancellationError(before);
    const loaded = yield* loadResolved(state, read);
    const after = cancelled();
    if (after !== undefined) throw cancellationError(after);
    if (loaded === undefined) return undefined;
    return attachDocument(
      state,
      read,
      loaded,
      (value, release) =>
        new CommittedWatch<ObservedDocumentValue>(value, release, (error) =>
          state.hooks.report(error),
        ),
    ).observer;
  });

export const watchDocument: Dual3<
  SessionState,
  AnyDocToken,
  readonly unknown[],
  Effect.Effect<DocumentWatch<JsonObject> | undefined>
> = Function.dual(3, (state: SessionState, token: AnyDocToken, args: readonly unknown[]) =>
  Effect.suspend(() => {
    assertUsable(state);
    const read = resolveRead(token, args);
    const signal = read.context.abortSignal;
    let aborted = signal?.aborted ?? false;
    const markCancelled = (): void => {
      aborted = true;
    };
    const cancelled = (): AbortSignal | undefined => (aborted ? signal : undefined);
    signal?.addEventListener("abort", markCancelled, { once: true });
    return Effect.gen(function* () {
      const watch = yield* Effect.promise(() =>
        enqueueHealthy(state, attachWatch(state, read, cancelled)),
      );
      if (watch === undefined) return undefined;
      const current = cancelled();
      if (current !== undefined) {
        watch.cancel();
        throw cancellationError(current);
      }
      if (signal !== undefined) watch.observeCancellation(signal);
      return watch as DocumentWatch<JsonObject>;
    }).pipe(
      Effect.ensuring(Effect.sync(() => signal?.removeEventListener("abort", markCancelled))),
    );
  }),
);
