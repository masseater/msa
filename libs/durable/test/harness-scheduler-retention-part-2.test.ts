import { rm } from "node:fs/promises";

import { defineTask, type TaskId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import {
  gate,
  gates,
  Hold,
  runs,
  directories,
  sqlitePath,
  rejections,
} from "./harness-scheduler-retention-support.ts";
import { context } from "./session-support.ts";
import { openTasks } from "./task-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  rejections.length = 0;
  for await (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("scheduler retention", () => {
  // A wait on an ended task closes no cycle (#10411), also when the ended task owns the waiter's conversation and the
  // scheduler forgot it: the wait resumes at once.
  it("lets a task wait on a forgotten ended owner", async () => {
    const opened = await openTasks(await openNodeSqliteStorage(await sqlitePath()), [Hold, Waiter]);
    const root = await opened.harness.root(context);
    opened.harness.resume();
    const tree = await root.commit(async (tx) => {
      const b = await tx.createTask(Hold, { name: "b" }, { ownership: { kind: "conversation" } });
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      return { b, c: c.id };
    }, context);
    gate("b").resolve();
    await opened.harness.waitForTask(tree.b, context);
    const c = (await opened.harness.conversation(tree.c, context))!;
    const waiter = await c.commit(
      (tx) => tx.createTask(Waiter, { on: [tree.b] }, { ownership: { kind: "conversation" } }),
      context,
    );
    const outcome = (await opened.harness.waitForTask(waiter, context)).state.outcome;
    expect(outcome).toMatchObject({ status: "completed" });
    await opened.harness.close(context);
  });
});

/** Waits on the tasks in its input, then completes. */
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
