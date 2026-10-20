import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { context, flush, openTestSession } = sessionSupport;

function throwingCheckpointDocs() {
  const state: { throwCheckpoint: boolean; firstCalls: number } = {
    firstCalls: 0,
    throwCheckpoint: true,
  };
  const First = defineDoc<{ count: number }>({
    checkpointWhen: () => {
      state.firstCalls++;
      return false;
    },
    initial: () => ({ count: 0 }),
    kind: "checkpoint.rollback.first",
    scope: "session",
    version: 1,
  });
  const Second = defineDoc<{ count: number }>({
    checkpointWhen: () => {
      if (state.throwCheckpoint) throw new Error("checkpoint failed");
      return false;
    },
    initial: () => ({ count: 0 }),
    kind: "checkpoint.rollback.second",
    scope: "session",
    version: 1,
  });
  return { First, Second, state };
}

const skipsPredicateEmpty = Effect.gen(function* () {
  let calls = 0;
  const Doc = defineDoc<{ items: string[] }>({
    checkpointWhen: () => {
      calls++;
      return false;
    },
    initial: () => ({ items: ["a", "b"] }),
    kind: "checkpoint.no-op",
    scope: "session",
    version: 1,
  });
  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Doc).then(() => undefined), context));
  const commits = storage.commits.length;

  yield* awaited(
    session.commit(
      (tx) =>
        tx.doc(Doc).then((value) => {
          value.items.push("x");
          value.items.pop();
          return undefined;
        }),
      context,
    ),
  );
  expect(calls).toBe(0);
  expect(storage.commits).toHaveLength(commits);

  yield* awaited(
    session.commit(
      (tx) =>
        tx.doc(Doc).then((value) => {
          const first = value.items.shift()!;
          value.items.unshift(first);
          return undefined;
        }),
      context,
    ),
  );
  expect(calls).toBe(1);
  expect(storage.commits.at(-1)![0]).toMatchObject({
    content: { kind: "delta" },
    type: "document.change",
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
    First,
    Second,
    commits,
    first,
    publications,
    published,
    runPromise,
    second,
    session,
    state,
    storage,
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
  return { First, Second, runPromise, session };
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
