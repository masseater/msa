import { type ConversationId, defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { context, createConversation, flush, openTestSession } = sessionSupport;

function failingCheckpointDocs() {
  const Copied = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "copied" }),
    kind: "fork.rollback.copied",
    scope: "conversation",
    version: 1,
  });
  const toggle: { failCheckpoint: boolean } = { failCheckpoint: true };
  const Failure = defineDoc<{ count: number }>({
    checkpointWhen: () => {
      if (toggle.failCheckpoint) throw new Error("checkpoint failed");
      return false;
    },
    initial: () => ({ count: 0 }),
    kind: "fork.rollback.failure",
    scope: "session",
    version: 1,
  });
  return { Copied, Failure, toggle };
}

const rollsEveryCopiedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { Copied, toggle, Failure } = failingCheckpointDocs();
  const { session, storage, publications } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const forkAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const forkAtInner3 = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            yield* awaited(tx.doc(Copied, parentId));
            yield* awaited(tx.doc(Failure));
            return forkAtInner3;
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
  return { Copied, Failure, parentId, runPromise, session, toggle };
});

const rollsEveryCopied = Effect.gen(function* () {
  const { runPromise, Copied, toggle, Failure, session, parentId } = yield* rollsEveryCopiedStep1;
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

const failsSessionRejectedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "source" }),
    kind: "fork.storage-rejected",
    scope: "conversation",
    version: 1,
  });
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  return { Doc, parentId, runPromise, session, storage };
});

const failsSessionRejected = Effect.gen(function* () {
  const { runPromise, Doc, session, storage, parentId } = yield* failsSessionRejectedStep1;
  const forkAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const forkAtInner2 = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            yield* awaited(tx.doc(Doc, parentId));
            return forkAtInner2;
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
    ).rejects.toMatchObject({ cause: rejection, name: "SessionFailed" }),
  );
  expect(yield* awaited(session.closed)).toEqual({ error: rejection, reason: "failed" });
  expect(yield* awaited(storage.reopen().conversation(rejectedChildId, context))).toBeUndefined();
});

describe("Session conversation document forks", () => {
  it("fails the Session on a rejected fork commit, which leaves no effect", () =>
    Effect.runPromise(failsSessionRejected));
});

const retiresCopiedDocumentStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "fresh" }),
    kind: "fork.retire-recreate",
    scope: "conversation",
    version: 1,
  });
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const forkAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const forkAtInner = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            (yield* awaited(tx.doc(Doc, parentId))).value = "copied";
            return forkAtInner;
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
  return { Doc, child, session, storage };
});

const retiresCopiedDocument = Effect.gen(function* () {
  const { Doc, session, storage, child } = yield* retiresCopiedDocumentStep1;
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
