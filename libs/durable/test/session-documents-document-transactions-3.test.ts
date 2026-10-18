import type { Draft } from "@msa/chord";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { setupLive, LiveDoc, type Live } from "./session-documents-support.ts";
import { context, documentChanges, flush } from "./session-support.ts";

const failsSessionStorage = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  yield* flush;
  const before = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  const published = publications.length;
  storage.failNextCommit(new Error("disk vanished"));
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(LiveDoc, conversationId))).message = "uncertain";
            }),
          ),
        context,
      ),
    ).rejects.toThrow("disk vanished"),
  );
  yield* flush;
  expect(publications.length).toBe(published);
  expect(before.message).toBeUndefined();
  yield* awaited(
    expect(session.snapshot(LiveDoc, conversationId, context)).rejects.toMatchObject({
      name: "SessionFailed",
    }),
  );
  yield* awaited(
    expect(session.commit(() => undefined, context)).rejects.toMatchObject({
      name: "SessionFailed",
    }),
  );
  yield* awaited(session.close(context));
});

const keepsPreviousRevision = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, conversationId } = yield* setupLive();
  const before = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  const copy = structuredClone(before);
  const gate = storage.holdCommits();
  const commit = session.commit(
    (tx) =>
      runPromise(
        Effect.gen(function* () {
          const live = yield* awaited(tx.doc(LiveDoc, conversationId));
          live.items.push("c");
          live.nested.count = 9;
        }),
      ),
    context,
  );
  yield* awaited(gate.entered);
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBe(before);
  expect(before).toEqual(copy);
  gate.release();
  yield* awaited(commit);
  const after = (yield* awaited(session.snapshot(LiveDoc, conversationId, context)))!;
  expect(after.items).toEqual(["a", "b", "c"]);
  expect(before).toEqual(copy);
});

describe("Session document transactions", () => {
  it("fails the Session after a Storage failure and publishes nothing", () =>
    Effect.runPromise(failsSessionStorage));

  it("keeps the previous revision unchanged through Storage settlement", () =>
    Effect.runPromise(keepsPreviousRevision));
});

const retiresDocumentsCreates = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications, conversationId } = yield* setupLive();
  yield* flush;
  const oldId = documentChanges(publications.at(-1)!)[0]!.record.id;
  let replacement: Draft<Live> | undefined;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const live = yield* awaited(tx.doc(LiveDoc, conversationId));
            live.message = "final";
            yield* awaited(tx.retireDoc(LiveDoc, conversationId));
            replacement = yield* awaited(tx.doc(LiveDoc, conversationId));
            expect(replacement).not.toBe(live);
            replacement.message = "new";
          }),
        ),
      context,
    ),
  );
  const writes = storage.commits.at(-1)!;
  expect(writes).toHaveLength(3);
  expect(writes).toContainEqual(expect.objectContaining({ type: "document.change", id: oldId }));
  expect(writes).toContainEqual({ type: "document.retire", id: oldId });
  expect(writes).toContainEqual(
    expect.objectContaining({
      type: "document.create",
      record: expect.objectContaining({ kind: "test.live" }),
    }),
  );
  yield* flush;
  const publication = publications.at(-1)!;
  const [retired, created] = documentChanges(publication);
  expect(retired).toMatchObject({ record: { id: oldId }, value: null, ops: [] });
  expect(retired!.record.retiredAt).toBe(publication.seq);
  expect(created!.record.id).not.toBe(oldId);
  expect(created!.record.createdAt).toBe(publication.seq);
  expect(created).toMatchObject({ value: { message: "new", items: [] }, ops: [] });
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBe(created!.value);

  yield* awaited(session.commit((tx) => tx.retireDoc(LiveDoc, conversationId), context));
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBeUndefined();
  yield* awaited(session.unloadDocuments());
  expect(yield* awaited(session.snapshot(LiveDoc, conversationId, context))).toBeUndefined();
  const commits = storage.commits.length;
  yield* awaited(session.commit((tx) => tx.retireDoc(LiveDoc, conversationId), context));
  expect(storage.commits.length).toBe(commits);
});

describe("Session document transactions", () => {
  it("retires documents and creates a new incarnation at the same address", () =>
    Effect.runPromise(retiresDocumentsCreates));
});
