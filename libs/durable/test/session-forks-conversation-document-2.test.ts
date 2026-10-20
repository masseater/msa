import durable from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { defineDoc } = durable;

const { awaited } = effectSupport;
const { context, createConversation, openTestSession } = sessionSupport;

function sourceWriteDocs() {
  const Current = defineDoc<{ value: string }>({
    fork: "current",
    history: "latest",
    initial: () => ({ value: "committed" }),
    kind: "fork.same-transaction-current",
    scope: "conversation",
    version: 1,
  });
  const AsOf = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "committed" }),
    kind: "fork.same-transaction-as-of",
    scope: "conversation",
    version: 1,
  });
  return { AsOf, Current };
}

const rejectsDuplicateCurrentStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const AsOf = defineDoc<{ value: string }>({
    fork: "asOf",
    history: "rewindable",
    initial: () => ({ value: "as-of" }),
    kind: "fork.duplicate-policy",
    scope: "conversation",
    version: 1,
  });
  const Current = defineDoc<{ value: string }>({
    fork: "current",
    history: "latest",
    initial: () => ({ value: "current" }),
    kind: "fork.duplicate-policy",
    scope: "conversation",
    version: 1,
  });
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  return { AsOf, Current, parentId, runPromise, session, storage };
});

const rejectsDuplicateCurrent = Effect.gen(function* () {
  const { runPromise, AsOf, Current, session, storage, parentId } =
    yield* rejectsDuplicateCurrentStep1;
  const oldAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const oldAtInner = (yield* awaited(tx.appendEntry(parentId, { kind: "old" }))).id;
            yield* awaited(tx.doc(AsOf, parentId));
            return oldAtInner;
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

const rejectsCurrentSourceStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { Current, AsOf } = sourceWriteDocs();
  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const forkAt = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const forkAtInner = (yield* awaited(tx.appendEntry(parentId, { kind: "point" }))).id;
            yield* awaited(tx.doc(Current, parentId));
            yield* awaited(tx.doc(AsOf, parentId));
            return forkAtInner;
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
  return { AsOf, Current, commits, forkAt, parentId, runPromise, session, storage };
});

const rejectsCurrentSource = Effect.gen(function* () {
  const { runPromise, Current, AsOf, session, storage, parentId, forkAt, commits } =
    yield* rejectsCurrentSourceStep1;
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
