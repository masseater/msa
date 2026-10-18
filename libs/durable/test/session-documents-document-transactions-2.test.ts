import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { setupLive, LiveDoc, MemberDoc } from "./session-documents-support.ts";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";

const retiresWithoutAcquisition = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  yield* flush;
  const oldId = documentChanges(publications.at(-1)!)[0]!.record.id;
  yield* awaited(session.unloadDocuments());
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const retired = tx.retireDoc(LiveDoc, conversationId);
            const replacement = tx.doc(LiveDoc, conversationId);
            const [live] = yield* awaited(Promise.all([replacement, retired]));
            live.message = "replacement";
          }),
        ),
      context,
    ),
  );
  const existingWrites = storage.commits.at(-1)!;
  expect(existingWrites).toHaveLength(2);
  expect(existingWrites).toContainEqual({ type: "document.retire", id: oldId });
  expect(existingWrites).toContainEqual(
    expect.objectContaining({
      type: "document.create",
      record: expect.objectContaining({ kind: "test.live" }),
    }),
  );

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const retired = tx.retireDoc(MemberDoc, "absent");
            const replacement = tx.doc(MemberDoc, "absent", "seed");
            const [member] = yield* awaited(Promise.all([replacement, retired]));
            member.hits = 1;
          }),
        ),
      context,
    ),
  );
  const absentWrites = storage.commits.at(-1)!;
  expect(absentWrites.filter((write) => write.type === "document.retire")).toHaveLength(0);
  expect(absentWrites.filter((write) => write.type === "document.create")).toHaveLength(1);
  expect(yield* awaited(session.snapshot(MemberDoc, "absent", context))).toEqual({
    seed: "seed",
    hits: 1,
  });
});

describe("Session document transactions", () => {
  it("retires without acquisition and recreates both existing and absent addresses", () =>
    Effect.runPromise(retiresWithoutAcquisition));
});

const retiresExistingIncarnation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  yield* flush;
  const oldId = documentChanges(publications.at(-1)!)[0]!.record.id;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const acquired = tx.doc(LiveDoc, conversationId);
            const retired = tx.retireDoc(LiveDoc, conversationId);
            (yield* awaited(acquired)).message = "final";
            yield* awaited(retired);
          }),
        ),
      context,
    ),
  );
  const firstWrites = storage.commits.at(-1)!;
  expect(firstWrites).toHaveLength(2);
  expect(firstWrites).toContainEqual({
    type: "document.change",
    id: oldId,
    content: expect.objectContaining({ kind: "delta" }),
  });
  expect(firstWrites).toContainEqual({ type: "document.retire", id: oldId });
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBeUndefined();

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "second";
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const secondId = documentChanges(publications.at(-1)!)[0]!.record.id;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const acquired = tx.doc(LiveDoc, conversationId);
            const retired = tx.retireDoc(LiveDoc, conversationId);
            const recreated = tx.doc(LiveDoc, conversationId);
            const [old, fresh] = yield* awaited(Promise.all([acquired, recreated, retired]));
            expect(fresh).not.toBe(old);
            fresh!.message = "third";
          }),
        ),
      context,
    ),
  );
  const writes = storage.commits.at(-1)!;
  expect(writes).toHaveLength(2);
  expect(writes).toContainEqual({ type: "document.retire", id: secondId });
  expect(writes).toContainEqual(
    expect.objectContaining({
      type: "document.create",
      record: expect.objectContaining({ kind: "test.live" }),
    }),
  );
  expect((yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!.message).toBe(
    "third",
  );
});

describe("Session document transactions", () => {
  it("retires the existing incarnation when retirement races a pending acquisition", () =>
    Effect.runPromise(retiresExistingIncarnation));
});

const reloadsUnloadedDocument = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, conversationId } = yield* setupLive();
  const loaded = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  yield* awaited(session.unloadDocuments());
  const reloaded = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  expect(reloaded).not.toBe(loaded);
  expect(reloaded).toEqual(loaded);
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, conversationId))).items.push("c");
          }),
        ),
      context,
    ),
  );
  yield* awaited(session.unloadDocuments());
  expect((yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!.items).toEqual([
    "a",
    "b",
    "c",
  ]);
});

const deliversCompletePublications = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, publications, conversationId } = yield* setupLive();
  const published = publications.length;
  let listenerContext: typeof context | undefined;
  const unsubscribe = session.subscribeCommits((_publication, deliveredContext) => {
    listenerContext = deliveredContext;
  });
  const result = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "m";
            return "done";
          }),
        ),
      context,
    ),
  );
  expect(result).toBe("done");
  expect(listenerContext).toBe(context);
  expect(publications.length).toBe(published + 1);
  unsubscribe();
});

const publishesCloseSynchronously = Effect.gen(function* () {
  const { session } = openTestSession();
  const calls: string[] = [];
  session.subscribeClose(() => calls.push("active"));
  const unsubscribe = session.subscribeClose(() => calls.push("removed"));
  unsubscribe();
  yield* awaited(session.close(context));
  expect(calls).toEqual(["active"]);
});

describe("Session document transactions", () => {
  it("reloads an unloaded document from Storage", () => Effect.runPromise(reloadsUnloadedDocument));

  it("delivers complete publications synchronously after adoption", () =>
    Effect.runPromise(deliversCompletePublications));

  it("publishes close synchronously and supports unsubscription", () =>
    Effect.runPromise(publishesCloseSynchronously));
});

const settlesAdmittedCommits = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, conversationId } = yield* setupLive();
  const gate = storage.holdCommits();
  const commit = session.commit(
    (tx) =>
      runPromise(
        Effect.gen(function* () {
          (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "admitted";
        }),
      ),
    context,
  );
  yield* awaited(gate.entered);
  const queued = session.commit(
    (tx) =>
      runPromise(
        Effect.gen(function* () {
          (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "queued";
        }),
      ),
    context,
  );
  const admittedSnapshot = session.snapshot(MemberDoc, "absent", context);
  const closed = session.close(context);
  yield* awaited(expect(session.commit(() => undefined, context)).rejects.toThrow("closed"));
  yield* awaited(
    expect(session.snapshot(LiveDoc, conversationId, context)).rejects.toThrow("closed"),
  );
  gate.release();
  yield* awaited(commit);
  yield* awaited(queued);
  expect(yield* awaited(admittedSnapshot)).toBeUndefined();
  yield* awaited(closed);
  const stored = yield* awaited(
    storage
      .findDocument(
        { kind: "test.live", scope: { kind: "conversation", conversationId } },
        "current",
        context,
      )
      .catch((error: unknown) => error),
  );
  expect(stored).toBeInstanceOf(Error);
});

describe("Session document transactions", () => {
  it("settles admitted commits before close and rejects later admission", () =>
    Effect.runPromise(settlesAdmittedCommits));
});
