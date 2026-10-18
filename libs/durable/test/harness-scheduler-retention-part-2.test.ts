import { defineTask, type TaskId } from "@msa/durable";
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
  rejections,
} from "./harness-scheduler-retention-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { openTasks } from "./task-support.ts";

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

const letsTaskWait = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(yield* sqlitePath())), [
    Hold,
    Waiter,
  ]);
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
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
  yield* awaited(opened.harness.waitForTask(tree.b, context));
  const c = (yield* awaited(opened.harness.conversation(tree.c, context)))!;
  const waiter = yield* awaited(
    c.commit(
      (tx) => tx.createTask(Waiter, { on: [tree.b] }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const outcome = (yield* awaited(opened.harness.waitForTask(waiter, context))).state.outcome;
  expect(outcome).toMatchObject({ status: "completed" });
  yield* awaited(opened.harness.close(context));
});

describe("scheduler retention", () => {
  it("lets a task wait on a forgotten ended owner", () => Effect.runPromise(letsTaskWait));
});

const Waiter = defineTask<{ on: TaskId[] }, { phase: "wait" } | { phase: "done" }, null>({
  name: "test.retention.waiter",
  version: 1,
  initial: () => ({ phase: "wait" }),
  phases: {
    wait: (task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(
          () => ({
            status: "waiting",
            checkpoint: { phase: "done" },
            on: task.input.on,
            policy: "allSettled",
          }),
          ctx,
        ),
      ),
    done: (_task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
          ctx,
        ),
      ),
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});
