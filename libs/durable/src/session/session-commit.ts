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

const applyChange = <T>(
  state: SessionState,
  tx: Transaction,
  change: (tx: Transaction) => T | Promise<T>,
): Effect.Effect<T> =>
  Effect.promise(() => Promise.resolve(change(tx))).pipe(
    Effect.tap(() => Effect.sync(() => assertHealthy(state))),
  );

const adopt = (state: SessionState, tx: Transaction, seq: Seq): DocumentCommitChange[] => {
  try {
    return tx.adopt(seq);
  } catch (error) {
    state.hooks.fail(error);
    throw error;
  }
};

export const runCommit = Effect.fnUntraced(function* <T>(
  state: SessionState,
  host: TransactionHost,
  change: (tx: Transaction) => T | Promise<T>,
  context: Context,
  scope: TransactionScope | undefined,
) {
  assertHealthy(state);
  context.abortSignal?.throwIfAborted();
  const tx = new Transaction(host, context, scope);
  const changed = yield* Effect.exit(applyChange(state, tx, change));
  if (Exit.isFailure(changed)) {
    yield* tx.settleFailure();
    return yield* failWith(changed.cause, () => sweepDocuments(state));
  }
  const settled = yield* Effect.exit(tx.settleSuccess());
  if (Exit.isFailure(settled)) return yield* failWith(settled.cause, () => sweepDocuments(state));
  const writes = settled.value;
  if (writes.length === 0) {
    tx.discard();
    sweepDocuments(state);
    return changed.value;
  }
  const stored = yield* Effect.exit(
    Effect.promise(() => state.storage.commit(writes, withoutAbortSignal(context))),
  );
  if (Exit.isFailure(stored)) return yield* failWith(stored.cause, () => tx.discard());
  const seq = stored.value;
  const documents = adopt(state, tx, seq);
  for (const document of documents) touchDocument(state, documentAddressId(document.record));
  publishCommit(state, { seq, writes, documents }, context);
  sweepDocuments(state);
  return changed.value;
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
