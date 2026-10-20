import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import documentWrites from "./session-checkpoints-migrations-support.ts";
import sessionSupport from "./session-support.ts";

const { awaited } = effectSupport;
const { context, documentChanges, flush, openTestSession } = sessionSupport;

const persistsRepeatedFalse = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let calls = 0;
  const Doc = defineDoc<{ values: number[] }>({
    checkpointWhen: () => {
      calls++;
      return false;
    },
    initial: () => ({ values: [] }),
    kind: "checkpoint.tail",
    scope: "session",
    version: 1,
  });
  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Doc).then(() => undefined), context));
  for (const value of Array.from({ length: 8 }, (_, i) => 1 + i)) {
    yield* awaited(
      session.commit(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              (yield* awaited(tx.doc(Doc))).values.push(value);
            }),
          ),
        context,
      ),
    );
  }
  const changes = storage.commits.flat().filter((write) => write.type === "document.change");
  expect(changes).toHaveLength(8);
  expect(changes.every((write) => write.content.kind === "delta")).toBe(true);
  expect(calls).toBe(8);
  yield* awaited(session.unloadDocuments());
  expect(yield* awaited(session.snapshot(Doc, context))).toEqual({
    values: [1, 2, 3, 4, 5, 6, 7, 8],
  });
});

describe("Session document checkpoints", () => {
  it("persists repeated false decisions as deltas and replays the complete tail", () =>
    Effect.runPromise(persistsRepeatedFalse));
});

const keepsPreparedRoot = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const initial: Record<string, number> = {};
  for (let index = 0; index < 4_100; index++) initial[`field${index}`] = 0;
  const Doc = defineDoc<Record<string, number>>({
    checkpointWhen: () => false,
    initial: () => initial,
    kind: "checkpoint.root-replacement",
    scope: "session",
    version: 1,
  });
  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Doc).then(() => undefined), context));
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const value = yield* awaited(tx.doc(Doc));
            for (let index = 0; index < 4_100; index++) value[`field${index}`] = 1;
          }),
        ),
      context,
    ),
  );
  const write = storage.commits.at(-1)![0]!;
  expect(write.type).toBe("document.change");
  if (write.type !== "document.change" || write.content.kind !== "delta") {
    throw new Error("Expected root replacement delta");
  }
  expect(write.content.ops).toHaveLength(1);
  expect(write.content.ops[0]![0]).toBe("r");
  yield* awaited(session.unloadDocuments());
  expect((yield* awaited(session.snapshot(Doc, context)))!["field4099"]).toBe(1);
});

describe("Session document checkpoints", () => {
  it("keeps a prepared root replacement as a delta when the predicate is false", () =>
    Effect.runPromise(keepsPreparedRoot));
});

const usesOrdinaryCheckpoint = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let calls = 0;
  const Doc = defineDoc<{ count: number }>({
    checkpointWhen: () => {
      calls++;
      return true;
    },
    initial: () => ({ count: 0 }),
    kind: "checkpoint.retire",
    scope: "session",
    version: 1,
  });
  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Doc).then(() => undefined), context));
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Doc))).count = 1;
            yield* awaited(tx.retireDoc(Doc));
          }),
        ),
      context,
    ),
  );
  expect(calls).toBe(1);
  expect(documentWrites(storage.commits.at(-1)!)).toEqual([
    expect.objectContaining({
      content: expect.objectContaining({ kind: "base" }),
      type: "document.change",
    }),
    expect.objectContaining({ type: "document.retire" }),
  ]);
});

describe("Session document checkpoints", () => {
  it("uses ordinary checkpoint selection before retirement", () =>
    Effect.runPromise(usesOrdinaryCheckpoint));
});

const migratedBaseSession = Effect.fn("migratedBaseSession")(function* () {
  const Old = defineDoc<{ count: number }>({
    initial: () => ({ count: 4 }),
    kind: "migration.transition",
    scope: "session",
    version: 1,
  });
  const calls: { checkpoints: number } = { checkpoints: 0 };
  const Current = defineDoc<{ count: number }>({
    checkpointWhen: () => {
      calls.checkpoints++;
      return false;
    },
    initial: () => ({ count: 0 }),
    kind: "migration.transition",
    migrate: (value, fromVersion) => ({ count: (value["count"] as number) + fromVersion - 1 }),
    scope: "session",
    version: 3,
  });
  const { session, storage, publications } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Old).then(() => undefined), context));
  yield* awaited(session.unloadDocuments());
  return { Current, Old, calls, publications, session, storage };
});

const watchedMigratedBase = Effect.fn("watchedMigratedBase")(function* () {
  const { Old, calls, Current, session, storage, publications } = yield* migratedBaseSession();
  const watch = (yield* awaited(session.watchDoc(Old, context)))!;
  const frames: unknown[] = [];
  watch.start((value, ops) => {
    frames.push({ ops, value });

    return Promise.resolve();
  });
  return { Current, calls, frames, publications, session, storage, watch };
});

const migratesReadOnly = Effect.gen(function* () {
  type CurrentValue = { count: number; labels: string[] };
  const Old = defineDoc<{ count: number }>({
    initial: () => ({ count: 2 }),
    kind: "migration.read-only",
    scope: "session",
    version: 1,
  });
  let calls = 0;
  let retained: CurrentValue | undefined;
  const Current = defineDoc<CurrentValue>({
    initial: () => ({ count: 0, labels: [] }),
    kind: "migration.read-only",
    migrate: (value, fromVersion) => {
      expect(fromVersion).toBe(1);
      calls++;
      retained = { count: value["count"] as number, labels: ["migrated"] };
      return retained;
    },
    scope: "session",
    version: 3,
  });
  const { session, storage } = openTestSession();
  yield* awaited(session.commit((tx) => tx.doc(Old).then(() => undefined), context));
  yield* awaited(session.unloadDocuments());
  const commits = storage.commits.length;

  const first = (yield* awaited(session.snapshot(Current, context)))!;
  expect(yield* awaited(session.snapshot(Current, context))).toBe(first);
  expect(calls).toBe(1);
  expect(storage.commits).toHaveLength(commits);
  retained!.count = 99;
  retained!.labels.push("mutated");
  expect(first).toEqual({ count: 2, labels: ["migrated"] });

  yield* awaited(session.unloadDocuments());
  const second = (yield* awaited(session.snapshot(Current, context)))!;
  expect(second).not.toBe(first);
  expect(second).toEqual(first);
  expect(calls).toBe(2);
  expect(storage.commits).toHaveLength(commits);
});

describe("Session document migrations", () => {
  it("migrates read-only once per cold load, copies the callback result, and writes nothing", () =>
    Effect.runPromise(migratesReadOnly));
});

const writesRequiredBase = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { calls, Current, session, storage, publications, watch, frames } =
    yield* watchedMigratedBase();
  expect(yield* awaited(session.snapshot(Current, context))).toEqual({ count: 4 });
  const snapshot = yield* awaited(session.snapshot(Current, context));
  const current = (yield* awaited(session.watchDoc(Current, context)))!;
  const currentFrames: unknown[] = [];
  current.start((value) => {
    currentFrames.push(value);

    return Promise.resolve();
  });

  yield* awaited(session.commit((tx) => tx.doc(Current).then(() => undefined), context));
  yield* flush;
  expect(storage.commits.at(-1)![0]).toMatchObject({
    content: { kind: "base", value: { count: 4 }, version: 3 },
    type: "document.change",
  });
  expect(calls.checkpoints).toBe(0);
  expect(documentChanges(publications.at(-1)!)).toMatchObject([
    { ops: [], value: { count: 4 }, version: 3 },
  ]);
  expect(frames).toEqual([{ ops: [["r", { count: 4 }]], value: { count: 4 } }]);
  expect(currentFrames).toEqual([]);
  yield* awaited(watch.stop());
  yield* awaited(current.stop());
  expect(yield* awaited(session.snapshot(Current, context))).toBe(snapshot);

  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Current))).count = 7;
          }),
        ),
      context,
    ),
  );
  expect(storage.commits.at(-1)![0]).toMatchObject({
    content: { kind: "delta", version: 3 },
    type: "document.change",
  });
  expect(calls.checkpoints).toBe(1);
  yield* awaited(session.unloadDocuments());
  expect(yield* awaited(session.snapshot(Current, context))).toEqual({ count: 7 });
});

describe("Session document migrations", () => {
  it("writes the required base on the first successful transaction, then writes deltas", () =>
    Effect.runPromise(writesRequiredBase));
});
