import type { Context } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import { Cause, Effect, Exit, Function } from "effect";

import { addressId as documentAddressId } from "../documents.ts";
import type {
  CommitChange,
  CommitPublication,
  DocumentCommitChange,
  Seq,
  StorageWrite,
} from "../types.ts";
import { dropDocument, loadDocument, sweepDocuments, touchDocument } from "./session-documents.ts";
import {
  assertHealthy,
  assertUsable,
  contained,
  enqueue,
  type SessionState,
} from "./session-state.ts";
import type { TransactionHost, TransactionScope } from "./transaction-types.ts";
import { Transaction } from "./transaction.ts";

export const createTransactionHost = (state: SessionState): TransactionHost => ({
  storage: state.storage,
  now: state.now,
  cached: (id) => {
    const cached = state.documents.get(id);
    if (cached !== undefined) touchDocument(state, id);
    return cached;
  },
  load: (definition, addressId, address, context) =>
    Effect.runPromise(loadDocument(state, definition, addressId, address, context)),
  install: (document) => {
    state.documents.set(document.addressId, document);
    touchDocument(state, document.addressId);
  },
  evict: (id, recordId) => {
    if (state.documents.get(id)?.record.id === recordId) dropDocument(state, id);
  },
  conversationCreated: (tx, record) => state.hooks.conversationCreated(tx, record),
});

const publish = (state: SessionState, publication: CommitPublication, context: Context): void => {
  for (const listener of [...state.internalListeners]) {
    contained(
      () => listener(publication, context),
      (error) => state.hooks.fail(error),
    );
  }
  for (const listener of [...state.commitListeners]) {
    contained(
      () => listener(publication, context),
      (error) => state.hooks.report(error),
    );
  }
};

const publishCommit = (
  state: SessionState,
  commit: {
    readonly seq: Seq;
    readonly writes: readonly StorageWrite[];
    readonly documents: readonly DocumentCommitChange[];
  },
  context: Context,
): void => {
  if (state.commitListeners.size === 0 && state.internalListeners.size === 0) return;
  const changes: CommitChange[] = [];
  for (const write of commit.writes) {
    switch (write.type) {
      case "conversation":
      case "entry":
      case "task":
      case "submission":
        changes.push(write);
    }
  }
  for (const document of commit.documents) changes.push(document);
  publish(state, { seq: commit.seq, changes }, context);
};

const failWith = (cause: Cause.Cause<never>, cleanup: () => void): Effect.Effect<never> =>
  Effect.suspend(() => {
    cleanup();
    return Effect.die(Cause.squash(cause));
  });

const runChange = Effect.fn("runChange")(function* <T>(
  state: SessionState,
  tx: Transaction,
  change: (tx: Transaction) => T | Promise<T>,
) {
  const result = yield* Effect.exit(
    Effect.promise(() => Promise.resolve(change(tx))).pipe(
      Effect.tap(() => Effect.sync(() => assertHealthy(state))),
    ),
  );
  if (Exit.isSuccess(result)) return result.value;
  yield* Effect.promise(() => tx.settleFailure());
  return yield* failWith(result.cause, () => sweepDocuments(state));
});

const settle = (state: SessionState, tx: Transaction) =>
  Effect.catchCause(
    Effect.promise(() => tx.settleSuccess()),
    (cause) => failWith(cause, () => sweepDocuments(state)),
  );

const store = (
  state: SessionState,
  tx: Transaction,
  writes: readonly StorageWrite[],
  context: Context,
) =>
  Effect.catchCause(
    Effect.promise(() => state.storage.commit(writes, withoutAbortSignal(context))),
    (cause) => failWith(cause, () => tx.discard()),
  );

const adopt = (state: SessionState, tx: Transaction, seq: Seq) =>
  Effect.catchCause(
    Effect.sync(() => tx.adopt(seq)),
    (cause) => failWith(cause, () => state.hooks.fail(Cause.squash(cause))),
  );

export const runCommit = Effect.fn("runCommit")(function* <T>(
  state: SessionState,
  host: TransactionHost,
  change: (tx: Transaction) => T | Promise<T>,
  context: Context,
  scope: TransactionScope | undefined,
) {
  assertHealthy(state);
  context.abortSignal?.throwIfAborted();
  const tx = new Transaction(host, context, scope);
  const result = yield* runChange(state, tx, change);
  const writes = yield* settle(state, tx);
  if (writes.length === 0) {
    tx.discard();
    sweepDocuments(state);
    return result;
  }
  const seq = yield* store(state, tx, writes, context);
  const documents = yield* adopt(state, tx, seq);
  for (const document of documents) touchDocument(state, documentAddressId(document.record));
  publishCommit(state, { seq, writes, documents }, context);
  sweepDocuments(state);
  return result;
});

export const commitOnLine: {
  <T>(
    host: TransactionHost,
    change: (tx: Transaction) => T | Promise<T>,
    context: Context,
    scope: TransactionScope | undefined,
  ): (state: SessionState) => Promise<T>;
  <T>(
    state: SessionState,
    host: TransactionHost,
    change: (tx: Transaction) => T | Promise<T>,
    context: Context,
    scope: TransactionScope | undefined,
  ): Promise<T>;
} = Function.dual(
  5,
  <T>(
    state: SessionState,
    host: TransactionHost,
    change: (tx: Transaction) => T | Promise<T>,
    context: Context,
    scope: TransactionScope | undefined,
  ): Promise<T> => {
    try {
      assertUsable(state);
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueue(state, () => Effect.runPromise(runCommit(state, host, change, context, scope)));
  },
);
