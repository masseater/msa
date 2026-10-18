import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import {
  gate,
  gates,
  Hold,
  runs,
  directories,
  sqlitePath,
  open,
  rejections,
} from "./harness-scheduler-retention-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { deferred, eventually, settled } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      runs.clear();
      rejections.length = 0;
      for (const directory of directories.splice(0)) yield* removeDir(directory);
    }),
  ),
);

const abortsWorkCreated = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* open();
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } }),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            const keep = yield* awaited(
              tx.createTask(Hold, { name: "keep" }, { ownership: { kind: "task", taskId: p } }),
            );
            return { p, b, c: c.id, keep };
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(tree.p)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              abortRequested: true,
            });
          }),
        ),
      context,
    ),
  );
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.getTask(tree.keep, context)))!.abortRequested;
      }),
    ),
  );
  const c = (yield* awaited(harness.conversation(tree.c, context)))!;
  const late = yield* awaited(
    c.commit(
      (tx) => tx.createTask(Hold, { name: "late" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  expect((yield* awaited(harness.waitForTask(late, context))).state.outcome.status).toBe("aborted");
  expect(runs.get("late") ?? 0).toBe(0);
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("aborts work created in a forgotten conversation below an abort-marked owner before it runs", () =>
    Effect.runPromise(abortsWorkCreated));
});

const keepsScopeBusy = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const storage = yield* awaited(openNodeSqliteStorage(path));
  const { harness, root } = yield* open(storage);
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "conversation" } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            return { b, c: c.id };
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  const read = storage.conversation.bind(storage);
  const held = deferred<void>();
  const reached = deferred<void>();
  let holding = false;
  let readsOfC = 0;
  storage.conversation = (id, readContext) =>
    runPromise(
      Effect.gen(function* () {
        if (holding && id === tree.c && ++readsOfC === 2) {
          reached.resolve();
          yield* awaited(held.promise);
        }
        return yield* awaited(read(id, readContext));
      }),
    );
  const c = (yield* awaited(harness.conversation(tree.c, context)))!;
  holding = true;
  yield* awaited(
    c.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  yield* awaited(reached.promise);
  expect(yield* settled(harness.waitForIdle(context))).toBe(false);
  held.resolve();
  gate("d").resolve();
  yield* awaited(harness.waitForIdle(context));
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("keeps a scope busy while the chain of new work below a forgotten conversation loads", () =>
    Effect.runPromise(keepsScopeBusy));
});
