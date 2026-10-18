import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { context, openTestSession } from "./session-support.ts";

const leavesUnaccessedOlderStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const FirstV1 = defineDoc<{ count: number }>({
    kind: "migration.lazy.first",
    version: 1,
    scope: "session",
    initial: () => ({ count: 1 }),
  });
  const SecondV1 = defineDoc<{ count: number }>({
    kind: "migration.lazy.second",
    version: 1,
    scope: "session",
    initial: () => ({ count: 2 }),
  });
  return { runPromise, FirstV1, SecondV1 };
});

const leavesUnaccessedOlder = Effect.gen(function* () {
  const { runPromise, FirstV1, SecondV1 } = yield* leavesUnaccessedOlderStep1;
  let secondMigrations = 0;
  const FirstV2 = defineDoc<{ count: number }>({
    kind: "migration.lazy.first",
    version: 2,
    scope: "session",
    initial: () => ({ count: 0 }),
    migrate: (value) => ({ count: value["count"] as number }),
  });
  defineDoc<{ count: number }>({
    kind: "migration.lazy.second",
    version: 2,
    scope: "session",
    initial: () => ({ count: 0 }),
    migrate: (value) => {
      secondMigrations++;
      return { count: value["count"] as number };
    },
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
