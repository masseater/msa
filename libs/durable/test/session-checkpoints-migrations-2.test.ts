import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, flush, openTestSession } from "./session-support.ts";

function throwingCheckpointDocs() {
  const state: { throwCheckpoint: boolean; firstCalls: number } = {
    throwCheckpoint: true,
    firstCalls: 0,
  };
  const First = defineDoc<{ count: number }>({
    kind: "checkpoint.rollback.first",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: () => {
      state.firstCalls++;
      return false;
    },
  });
  const Second = defineDoc<{ count: number }>({
    kind: "checkpoint.rollback.second",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: () => {
      if (state.throwCheckpoint) throw new Error("checkpoint failed");
      return false;
    },
  });
  return { state, First, Second };
}

const skipsPredicateEmpty = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let calls = 0;
  const Doc = defineDoc<{ items: string[] }>({
    kind: "checkpoint.no-op",
    version: 1,
    scope: "session",
    initial: () => ({ items: ["a", "b"] }),
    checkpointWhen: () => {
      calls++;
      return false;
    },
  });
  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Doc).then(() => undefined), context));
  const commits = storage.commits.length;

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const value = yield* awaited(tx.doc(Doc));
            value.items.push("x");
            value.items.pop();
          }),
        ),
      context,
    ),
  );
  expect(calls).toBe(0);
  expect(storage.commits).toHaveLength(commits);

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const value = yield* awaited(tx.doc(Doc));
            const first = value.items.shift()!;
            value.items.unshift(first);
          }),
        ),
      context,
    ),
  );
  expect(calls).toBe(1);
  expect(storage.commits.at(-1)![0]).toMatchObject({
    type: "document.change",
    content: { kind: "delta" },
  });
});

describe("Session document checkpoints", () => {
  it("skips the predicate for empty batches but calls it for nonempty structural no-ops", () =>
    Effect.runPromise(skipsPredicateEmpty));
});

const rollsBackEveryStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { state, First, Second } = throwingCheckpointDocs();
  const { session, storage, publications } = openTestSession();
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.doc(First));
            yield* awaited(tx.doc(Second));
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const first = (yield* awaited(session.snapshot(First, context)))!;
  const second = (yield* awaited(session.snapshot(Second, context)))!;
  const commits = storage.commits.length;
  const published = publications.length;
  return {
    runPromise,
    state,
    First,
    Second,
    session,
    storage,
    publications,
    first,
    second,
    commits,
    published,
  };
});

const rollsBackEveryStep2 = Effect.gen(function* () {
  const {
    runPromise,
    state,
    First,
    Second,
    session,
    storage,
    publications,
    first,
    second,
    commits,
    published,
  } = yield* rollsBackEveryStep1;
  yield* awaited(
    expect(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(First))).count = 1;
              (yield* awaited(tx.doc(Second))).count = 2;
            }),
          ),
        context,
      ),
    ).rejects.toThrow("checkpoint failed"),
  );
  yield* flush;
  expect(state.firstCalls).toBe(1);
  expect(storage.commits).toHaveLength(commits);
  expect(publications).toHaveLength(published);
  expect(yield* awaited(session.snapshot(First, context))).toBe(first);
  expect(yield* awaited(session.snapshot(Second, context))).toBe(second);

  state.throwCheckpoint = false;
  return { runPromise, First, Second, session };
});

const rollsBackEvery = Effect.gen(function* () {
  const { runPromise, First, Second, session } = yield* rollsBackEveryStep2;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(First))).count = 3;
            (yield* awaited(tx.doc(Second))).count = 4;
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(First, context))).toEqual({ count: 3 });
  expect(yield* awaited(session.snapshot(Second, context))).toEqual({ count: 4 });
});

describe("Session document checkpoints", () => {
  it("rolls back every prepared document when a checkpoint predicate throws", () =>
    Effect.runPromise(rollsBackEvery));
});
