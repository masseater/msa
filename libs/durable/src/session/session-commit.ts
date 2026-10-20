import contextModule from "@msa/chord/context";
import type chordTypes from "@msa/chord/index.types";
import { Cause, Effect, Exit, Function } from "effect";

import documentsModule from "../documents.ts";
import type typesModule from "../types.types.ts";
import type sessionCommitTypes from "./session-commit.types.ts";
import sessionDocuments from "./session-documents.ts";
import sessionState from "./session-state.ts";
import type transactionTypesModule from "./transaction-types.types.ts";
import Transaction from "./transaction.ts";

const { withoutAbortSignal } = contextModule;

const { dropDocument, loadDocument, sweepDocuments, touchDocument } = sessionDocuments;
const { assertHealthy, assertUsable, contained, enqueue } = sessionState;

const { addressId: documentAddressId } = documentsModule;

const createTransactionHost = (
  state: sessionCommitTypes.SessionState,
): transactionTypesModule.TransactionHost => ({
  cached: (id) => {
    const cached = state.documents.get(id);
    if (cached !== undefined) touchDocument(state, id);
    return cached;
  },
  conversationCreated: (tx, record) => state.hooks.conversationCreated(tx, record),
  evict: (id, recordId) => {
    if (state.documents.get(id)?.record.id === recordId) dropDocument(state, id);
  },
  install: (document) => {
    state.documents.set(document.addressId, document);
    touchDocument(state, document.addressId);
  },
  load: (definition, addressId, address, context) =>
    Effect.runPromise(loadDocument(state, definition, addressId, address, context)),
  now: state.now,
  storage: state.storage,
});

const publish = (
  state: sessionCommitTypes.SessionState,
  publication: typesModule.CommitPublication,
  context: chordTypes.Context,
): void => {
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
  state: sessionCommitTypes.SessionState,
  commit: {
    readonly seq: typesModule.Seq;
    readonly writes: readonly typesModule.StorageWrite[];
    readonly documents: readonly typesModule.DocumentCommitChange[];
  },
  context: chordTypes.Context,
): void => {
  if (state.commitListeners.size === 0 && state.internalListeners.size === 0) return;
  const changes: typesModule.CommitChange[] = [];
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
  publish(state, { changes, seq: commit.seq }, context);
};

const failWith = (cause: Cause.Cause<never>, cleanup: () => void): Effect.Effect<never> =>
  Effect.suspend(() => {
    cleanup();
    return Effect.die(Cause.squash(cause));
  });

const applyChange = <T>(
  state: sessionCommitTypes.SessionState,
  tx: sessionCommitTypes.Transaction,
  change: (tx: sessionCommitTypes.Transaction) => T | Promise<T>,
): Effect.Effect<T> =>
  Effect.promise(() => Promise.resolve(change(tx))).pipe(
    Effect.tap(() => Effect.sync(() => assertHealthy(state))),
  );

const adopt = (
  state: sessionCommitTypes.SessionState,
  tx: sessionCommitTypes.Transaction,
  seq: typesModule.Seq,
): typesModule.DocumentCommitChange[] => {
  try {
    return tx.adopt(seq);
  } catch (error) {
    state.hooks.fail(error);
    throw error;
  }
};

const runCommit = Effect.fnUntraced(function* <T>(
  state: sessionCommitTypes.SessionState,
  host: transactionTypesModule.TransactionHost,
  change: (tx: sessionCommitTypes.Transaction) => T | Promise<T>,
  context: chordTypes.Context,
  scope: transactionTypesModule.TransactionScope | undefined,
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
  publishCommit(state, { documents, seq, writes }, context);
  sweepDocuments(state);
  return changed.value;
});

const commitOnLine: {
  <T>(
    host: transactionTypesModule.TransactionHost,
    change: (tx: sessionCommitTypes.Transaction) => T | Promise<T>,
    context: chordTypes.Context,
    scope: transactionTypesModule.TransactionScope | undefined,
  ): (state: sessionCommitTypes.SessionState) => Promise<T>;
  <T>(
    state: sessionCommitTypes.SessionState,
    host: transactionTypesModule.TransactionHost,
    change: (tx: sessionCommitTypes.Transaction) => T | Promise<T>,
    context: chordTypes.Context,
    scope: transactionTypesModule.TransactionScope | undefined,
  ): Promise<T>;
} = Function.dual(
  5,
  <T>(
    state: sessionCommitTypes.SessionState,
    host: transactionTypesModule.TransactionHost,
    change: (tx: sessionCommitTypes.Transaction) => T | Promise<T>,
    context: chordTypes.Context,
    scope: transactionTypesModule.TransactionScope | undefined,
  ): Promise<T> => {
    try {
      assertUsable(state);
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueue(state, () => Effect.runPromise(runCommit(state, host, change, context, scope)));
  },
);

const sessionCommit = {
  commitOnLine,
  createTransactionHost,
  runCommit,
};

export default sessionCommit;
