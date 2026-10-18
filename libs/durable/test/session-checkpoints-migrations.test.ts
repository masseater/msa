import type { Op } from "@msa/chord/delta";
import { defineDoc, type JsonObject, type StorageWrite } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { documentWrites } from "./session-checkpoints-migrations-support.ts";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";

function checkpointDocs() {
  const calls: { value: Readonly<JsonObject>; ops: readonly Op[] }[] = [];
  const falseCalls: { value: Readonly<JsonObject>; ops: readonly Op[] }[] = [];
  const BaseDoc = defineDoc<{ items: string[] }>({
    kind: "checkpoint.base",
    version: 1,
    scope: "session",
    initial: () => ({ items: [] }),
    checkpointWhen: (value, ops) => {
      calls.push({ value, ops });
      return true;
    },
  });
  const DeltaDoc = defineDoc<{ count: number }>({
    kind: "checkpoint.delta",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: (value, ops) => {
      falseCalls.push({ value, ops });
      return false;
    },
  });
  const DefaultDoc = defineDoc<{ count: number }>({
    kind: "checkpoint.default",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
  });
  return { calls, falseCalls, BaseDoc, DeltaDoc, DefaultDoc };
}

function countingDocVersions() {
  const seen: number[] = [];
  const V1 = defineDoc<{ count: number }>({
    kind: "checkpoint.deltas-since-base",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen: (_value, _ops, info) => {
      seen.push(info.deltasSinceBase);
      return info.deltasSinceBase >= 2;
    },
  });
  const V2 = defineDoc<{ count: number }>({
    kind: "checkpoint.deltas-since-base",
    version: 2,
    scope: "session",
    initial: () => ({ count: 0 }),
    migrate: (value) => ({ count: value["count"] as number }),
    checkpointWhen: (_value, _ops, info) => {
      seen.push(info.deltasSinceBase);
      return false;
    },
  });
  return { seen, V1, V2 };
}

const callsCheckpointWhenDefinition = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Doc = defineDoc<{ count: number }>({
    kind: "checkpoint.receiver",
    version: 1,
    scope: "session",
    initial: () => ({ count: 0 }),
    checkpointWhen(value) {
      return value.count === this.initial().count + 2;
    },
  });
  const { session, storage } = openTestSession();
  for (const count of [0, 1, 2]) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(Doc))).count = count;
            }),
          ),
        context,
      ),
    );
  }
  const kinds = storage.commits.flatMap((writes) =>
    writes.flatMap((write) => (write.type === "document.change" ? [write.content.kind] : [])),
  );
  expect(kinds).toEqual(["delta", "base"]);
});

describe("Session document checkpoints", () => {
  it("calls checkpointWhen with its definition as the receiver", () =>
    Effect.runPromise(callsCheckpointWhenDefinition));
});

const selectsBasesOnly = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { calls, falseCalls, BaseDoc, DeltaDoc, DefaultDoc } = checkpointDocs();
  const { session, storage, publications } = openTestSession();

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.doc(BaseDoc));
            yield* awaited(tx.doc(DeltaDoc));
            yield* awaited(tx.doc(DefaultDoc));
          }),
        ),
      context,
    ),
  );
  expect(calls).toHaveLength(0);
  expect(falseCalls).toHaveLength(0);
  expect(documentWrites(storage.commits.at(-1)!)).toSatisfy((writes: readonly StorageWrite[]) =>
    writes.every((write) => write.type === "document.create" && write.content.kind === "base"),
  );

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(BaseDoc))).items.push("x");
            (yield* awaited(tx.doc(DeltaDoc))).count++;
            (yield* awaited(tx.doc(DefaultDoc))).count++;
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const writes = storage.admittedCommits
    .at(-1)!
    .filter((write) => write.type === "document.change");
  expect(writes.map((write) => write.content.kind)).toEqual(["base", "delta", "delta"]);
  expect(calls).toHaveLength(1);
  expect(falseCalls).toHaveLength(1);
  const snapshot = (yield* awaited(session.snapshot(BaseDoc, context)))!;
  const deltaSnapshot = (yield* awaited(session.snapshot(DeltaDoc, context)))!;
  const [published, publishedDelta] = documentChanges(publications.at(-1)!);
  expect(calls[0]!.value).toBe(snapshot);
  expect(calls[0]!.ops).toBe(published!.ops);
  expect(falseCalls[0]!.value).toBe(deltaSnapshot);
  expect(falseCalls[0]!.ops).toBe(publishedDelta!.ops);
  if (writes[1]!.type !== "document.change" || writes[1]!.content.kind !== "delta") {
    throw new Error("Expected ordinary delta");
  }
  expect(writes[1]!.content.ops).toBe(falseCalls[0]!.ops);
  expect(writes[0]!.type).toBe("document.change");
  if (writes[0]!.type !== "document.change" || writes[0]!.content.kind !== "base") {
    throw new Error("Expected checkpoint base");
  }
  expect(writes[0]!.content.value).toBe(snapshot);
});

describe("Session document checkpoints", () => {
  it("selects bases only for nonempty ordinary batches and passes the exact prepared revision and ops", () =>
    Effect.runPromise(selectsBasesOnly));
});

const passesStoredDelta = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { seen, V1, V2 } = countingDocVersions();
  const { session, storage } = openTestSession();
  const increment = (token: typeof V1): Promise<void> =>
    runPromise(
      Effect.gen(function* () {
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          session.commit(
            (tx) =>
              runPromise(
                Effect.gen(function* () {
                  (yield* awaited(tx.doc(token))).count++;
                }),
              ),
            context,
          ),
        );
      }),
    );
  yield* awaited(session.commit((tx) => tx.doc(V1).then(() => undefined), context));
  yield* awaited(increment(V1));
  yield* awaited(increment(V1));
  yield* awaited(increment(V1));
  yield* awaited(session.unloadDocuments());
  yield* awaited(increment(V1));
  expect(seen).toEqual([0, 1, 2, 0]);
  const kinds = storage.commits
    .slice(-4)
    .map((writes) =>
      writes[0]!.type === "document.change" ? writes[0]!.content.kind : writes[0]!.type,
    );
  expect(kinds).toEqual(["delta", "delta", "base", "delta"]);

  yield* awaited(increment(V2));
  yield* awaited(increment(V2));
  expect(seen).toEqual([0, 1, 2, 0, 0]);
  expect(storage.commits.at(-2)![0]).toMatchObject({ content: { kind: "base", version: 2 } });
});

describe("Session document checkpoints", () => {
  it("passes the stored delta count since the newest base, including after unload and version bases", () =>
    Effect.runPromise(passesStoredDelta));
});
