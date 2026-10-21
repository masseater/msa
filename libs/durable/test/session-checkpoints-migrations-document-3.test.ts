import durable from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";

const { defineDoc } = durable;

const { awaited } = effectSupport;
const { context, openTestSession } = sessionSupport;

const leavesUnaccessedOlderStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const FirstV1 = defineDoc<{ count: number }>({
    initial: () => ({ count: 1 }),
    kind: "migration.lazy.first",
    scope: "session",
    version: 1,
  });
  const SecondV1 = defineDoc<{ count: number }>({
    initial: () => ({ count: 2 }),
    kind: "migration.lazy.second",
    scope: "session",
    version: 1,
  });
  return { FirstV1, SecondV1, runPromise };
});

const leavesUnaccessedOlder = Effect.gen(function* () {
  const { runPromise, FirstV1, SecondV1 } = yield* leavesUnaccessedOlderStep1;
  let secondMigrations = 0;
  const FirstV2 = defineDoc<{ count: number }>({
    initial: () => ({ count: 0 }),
    kind: "migration.lazy.first",
    migrate: (value) => ({ count: value["count"] as number }),
    scope: "session",
    version: 2,
  });
  defineDoc<{ count: number }>({
    initial: () => ({ count: 0 }),
    kind: "migration.lazy.second",
    migrate: (value) => {
      secondMigrations++;
      return { count: value["count"] as number };
    },
    scope: "session",
    version: 2,
  });
  const { session, storage } = openTestSession();
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.doc(FirstV1));
            yield* awaited(tx.doc(SecondV1));
          }),
        ),
      context,
    ),
  );
  yield* awaited(session.unloadDocuments());
  const commits = storage.commits.length;
  expect(yield* awaited(session.snapshot(FirstV2, context))).toEqual({ count: 1 });
  expect(storage.commits).toHaveLength(commits);
  expect(secondMigrations).toBe(0);
  const secondRecord = yield* awaited(
    storage.findDocument(
      { kind: "migration.lazy.second", scope: { kind: "session" } },
      "current",
      context,
    ),
  );
  expect((yield* awaited(storage.document(secondRecord!.id, "current", context)))!.version).toBe(1);
});

describe("Session document migrations", () => {
  it("leaves unaccessed older documents and unavailable definitions untouched", () =>
    Effect.runPromise(leavesUnaccessedOlder));
});
