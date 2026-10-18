import { type ConversationId, defineDoc, type EntryId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, createConversation, flush, openTestSession } from "./session-support.ts";

function sourceWriteDocs() {
  const Current = defineDoc<{ value: string }>({
    kind: "fork.same-transaction-current",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: "committed" }),
  });
  const AsOf = defineDoc<{ value: string }>({
    kind: "fork.same-transaction-as-of",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "committed" }),
  });
  return { Current, AsOf };
}

function failingCheckpointDocs() {
  const Copied = defineDoc<{ value: string }>({
    kind: "fork.rollback.copied",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "copied" }),
  });
  const toggle: { failCheckpoint: boolean } = { failCheckpoint: true };
  const Failure = defineDoc<{ count: number }>({
    kind: "fork.rollback.failure",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: () => {
      if (toggle.failCheckpoint) throw new Error("checkpoint failed");
      return false;
    },
  });
  return { Copied, toggle, Failure };
}

const rejectsDuplicateCurrent = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const AsOf = defineDoc<{ value: string }>({
    kind: "fork.duplicate-policy",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "as-of" }),
  });
  const Current = defineDoc<{ value: string }>({
    kind: "fork.duplicate-policy",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: "current" }),
  });
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  let oldAt!: EntryId;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            oldAt = (yield* awaited(tx.appendEntry(parentId, { kind: "old" }))).id;
            yield* awaited(tx.doc(AsOf, parentId));
          }),
        ),
      context,
    ),
  );
  yield* awaited(session.commit((tx) => tx.retireDoc(AsOf, parentId), context));
  yield* awaited(session.commit((tx) => tx.doc(Current, parentId).then(() => undefined), context));
  const commits = storage.commits.length;
  yield* awaited(
    expect(
      session.commit(
        (tx) => tx.forkConversation(parentId, oldAt, { ownership: { kind: "ownerless" } }),
        context,
      ),
    ).rejects.toThrow("Fork selects multiple source documents"),
  );
  expect(storage.commits).toHaveLength(commits);
  const independent = yield* awaited(
    session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
  );
  expect(yield* awaited(storage.conversation(independent.id, context))).toEqual(independent);
});

describe("Session conversation document forks", () => {
  it("rejects duplicate as-of and current selections for one child address before admission", () =>
    Effect.runPromise(rejectsDuplicateCurrent));
});

const rejectsCurrentSource = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { Current, AsOf } = sourceWriteDocs();
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  let forkAt!: EntryId;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            forkAt = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            yield* awaited(tx.doc(Current, parentId));
            yield* awaited(tx.doc(AsOf, parentId));
          }),
        ),
      context,
    ),
  );
  const commits = storage.commits.length;
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(Current, parentId))).value = "before-fork";
              yield* awaited(
                tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
              );
            }),
          ),
        context,
      ),
    ).rejects.toThrow("Cannot change fork source document"),
  );
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              yield* awaited(
                tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
              );
              (yield* awaited(tx.doc(Current, parentId))).value = "after-fork";
            }),
          ),
        context,
      ),
    ).rejects.toThrow("Cannot change fork source document"),
  );
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(AsOf, parentId))).value = "as-of-write";
              yield* awaited(
                tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
              );
            }),
          ),
        context,
      ),
    ).rejects.toThrow("Cannot change fork source document"),
  );
  expect(storage.commits).toHaveLength(commits);
  expect(yield* awaited(session.snapshot(Current, parentId, context))).toEqual({
    value: "committed",
  });
  const child = yield* awaited(
    session.commit(
      (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(Current, child.id, context))).toEqual({
    value: "committed",
  });
});

describe("Session conversation document forks", () => {
  it("rejects current and as-of source writes in the fork transaction", () =>
    Effect.runPromise(rejectsCurrentSource));
});

const rollsEveryCopied = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { Copied, toggle, Failure } = failingCheckpointDocs();
  const { session, storage, publications } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  let forkAt!: EntryId;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            forkAt = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            yield* awaited(tx.doc(Copied, parentId));
            yield* awaited(tx.doc(Failure));
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const commits = storage.commits.length;
  const published = publications.length;
  let childId!: ConversationId;
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              childId = (yield* awaited(
                tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
              )).id;
              (yield* awaited(tx.doc(Failure))).count = 1;
            }),
          ),
        context,
      ),
    ).rejects.toThrow("checkpoint failed"),
  );
  yield* flush;
  expect(storage.commits).toHaveLength(commits);
  expect(publications).toHaveLength(published);
  expect(yield* awaited(storage.conversation(childId, context))).toBeUndefined();
  toggle.failCheckpoint = false;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Failure))).count = 2;
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(Failure, context))).toEqual({ count: 2 });
  expect(yield* awaited(session.snapshot(Copied, parentId, context))).toEqual({
    value: "copied",
  });
});

describe("Session conversation document forks", () => {
  it("rolls every copied base back when later pre-admission assembly fails", () =>
    Effect.runPromise(rollsEveryCopied));
});

const failsSessionRejected = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ value: string }>({
    kind: "fork.storage-rejected",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "source" }),
  });
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  let forkAt!: EntryId;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            forkAt = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            yield* awaited(tx.doc(Doc, parentId));
          }),
        ),
      context,
    ),
  );
  let rejectedChildId!: ConversationId;
  const rejection = new Error("copy rejected");
  storage.failNextCommit(rejection);
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              rejectedChildId = (yield* awaited(
                tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
              )).id;
            }),
          ),
        context,
      ),
    ).rejects.toBe(rejection),
  );
  yield* awaited(
    expect(
      session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context),
    ).rejects.toMatchObject({ name: "SessionFailed", cause: rejection }),
  );
  expect(yield* awaited(session.closed)).toEqual({ reason: "failed", error: rejection });
  expect(yield* awaited(storage.reopen().conversation(rejectedChildId, context))).toBeUndefined();
});

describe("Session conversation document forks", () => {
  it("fails the Session on a rejected fork commit, which leaves no effect", () =>
    Effect.runPromise(failsSessionRejected));
});

const retiresCopiedDocument = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ value: string }>({
    kind: "fork.retire-recreate",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: "fresh" }),
  });
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  let forkAt!: EntryId;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            forkAt = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            (yield* awaited(tx.doc(Doc, parentId))).value = "copied";
          }),
        ),
      context,
    ),
  );
  const child = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const created = yield* awaited(
              tx.forkConversation(parentId, forkAt, {
                ownership: { kind: "ownerless" },
              }),
            );
            yield* awaited(tx.retireDoc(Doc, created.id));
            (yield* awaited(tx.doc(Doc, created.id))).value = "replacement";
            return created;
          }),
        ),
      context,
    ),
  );
  const writes = storage.commits.at(-1)!;
  expect(writes.filter((write) => write.type === "document.copy")).toHaveLength(1);
  expect(writes.filter((write) => write.type === "document.create")).toHaveLength(1);
  expect(writes.filter((write) => write.type === "document.retire")).toHaveLength(1);
  expect(yield* awaited(session.snapshot(Doc, child.id, context))).toEqual({
    value: "replacement",
  });
});

describe("Session conversation document forks", () => {
  it("retires a copied document and can recreate the address in the fork transaction", () =>
    Effect.runPromise(retiresCopiedDocument));
});
