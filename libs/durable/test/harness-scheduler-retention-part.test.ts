import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import {
  status,
  sizes,
  gate,
  gates,
  Hold,
  runs,
  directories,
  sqlitePath,
  open,
  Rejected,
  rejections,
} from "./harness-scheduler-retention-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { eventually } from "./task-support.ts";

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

const keepsChainOneStep1 = Effect.gen(function* () {
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
            const old = yield* awaited(
              tx.createTask(
                Hold,
                { name: "old" },
                {
                  ownership: { kind: "conversation" },
                  conversationId: c.id,
                  background: true,
                },
              ),
            );
            return { p, b, c: c.id, old };
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  return { runPromise, harness, tree };
});

const keepsChainOne = Effect.gen(function* () {
  const { runPromise, harness, tree } = yield* keepsChainOneStep1;
  const replacement = yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const old = (yield* awaited(tx.task(tree.old)))!;
            const id = yield* awaited(
              tx.createTask(
                Hold,
                { name: "new" },
                { ownership: { kind: "conversation" }, conversationId: tree.c },
              ),
            );
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...old,
              state: { status: "terminal", outcome: { status: "completed", result: null } },
            });
            return id;
          }),
        ),
      context,
    ),
  );
  gate("p").resolve();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* status(harness, tree.p)).status === "completing";
      }),
    ),
  );
  gate("new").resolve();
  yield* awaited(harness.waitForTask(replacement, context));
  expect((yield* awaited(harness.waitForTask(tree.p, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("keeps a chain when one commit ends its last task and creates new work below it", () =>
    Effect.runPromise(keepsChainOne));
});

const dropsWhatRejected = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* open();
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(Rejected, { into: 0 }, { ownership: { kind: "conversation" } }),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            return { p, b, c: c.id };
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(tree.p)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              input: { into: tree.c },
            });
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  const baseline = sizes(harness);
  gate("rejected").resolve();
  yield* eventually(() => rejections.length > 0);
  yield* eventually(() => sizes(harness).dropQueue === 0);
  expect(sizes(harness)).toEqual(baseline);
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("drops what a rejected commit's chain load read, without a later publication", () =>
    Effect.runPromise(dropsWhatRejected));
});

const dropsWhatRead = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  let opened = yield* open(yield* awaited(openNodeSqliteStorage(path)));
  const tree = yield* awaited(
    opened.root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "conversation" } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            const d = yield* awaited(
              tx.createTask(
                Hold,
                { name: "d" },
                { ownership: { kind: "conversation" }, conversationId: c.id },
              ),
            );
            return { b, d };
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* status(opened.harness, tree.b)).status === "completing";
      }),
    ),
  );
  yield* awaited(opened.harness.close(context));
  gates.clear();
  opened = yield* open(yield* awaited(openNodeSqliteStorage(path)));
  yield* awaited(opened.harness.inspect(context));
  expect(sizes(opened.harness).unloaded).toBe(0);
  gate("d").resolve();
  yield* awaited(opened.harness.waitForTask(tree.d, context));
  yield* awaited(opened.harness.waitForTask(tree.b, context));
  yield* eventually(() => sizes(opened.harness).dropQueue === 0);
  expect(sizes(opened.harness)).toMatchObject({ settled: 0, below: 0, unloaded: 0 });
  yield* awaited(opened.harness.close(context));
});

describe("scheduler retention", () => {
  it("drops what a read loaded after reopen, without a later publication", () =>
    Effect.runPromise(dropsWhatRead));
});
