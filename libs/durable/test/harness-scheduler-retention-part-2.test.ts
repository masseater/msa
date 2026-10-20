import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import harnessSchedulerRetentionSupport from "./harness-scheduler-retention-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { openNodeSqliteStorage } = node;
const { defineTask } = durable;

const { awaited } = effectSupport;
const { Hold, directories, gate, gates, rejections, runs, sqlitePath } =
  harnessSchedulerRetentionSupport;
const { removeDir } = platformSupport;
const { context } = sessionSupport;
const { openTasks } = taskSupport;

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

const Waiter = defineTask<
  { on: durableTypes.TaskId[] },
  { phase: "wait" } | { phase: "done" },
  null
>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "wait" }),
  name: "test.retention.waiter",
  phases: {
    done: (_task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(
          () => ({ outcome: { result: null, status: "completed" }, status: "terminal" }),
          ctx,
        ),
      ),
    wait: (task, runtime, ctx) =>
      Promise.resolve(
        runtime.commit(
          () => ({
            checkpoint: { phase: "done" },
            on: task.input.on,
            policy: "allSettled",
            status: "waiting",
          }),
          ctx,
        ),
      ),
  },
  version: 1,
});
