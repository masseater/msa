import { rm } from "node:fs/promises";

import { defineTask } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import {
  runtimes,
  owned,
  state,
  directories,
  sqlitePath,
  gates,
  gate,
  Hold,
} from "./harness-scheduler-indexes-support.ts";
import { context } from "./session-support.ts";
import { aborted, eventually, openTasks } from "./task-support.ts";

/** Records its owned tasks once its `look` gate opens, then holds until its own gate opens. */
const Probe = defineTask<{ name: string }, { phase: "look" }, null>({
  name: "test.index.probe",
  version: 1,
  initial: () => ({ phase: "look" }),
  phases: {
    look: async (task, runtime, ctx) => {
      runtimes.set(task.input.name, runtime);
      await Promise.race([gate(`look.${task.input.name}`).promise, aborted(runtime.signal)]);
      owned.set(
        task.input.name,
        (await runtime.ownedTasks(ctx)).map((record) => record.id),
      );
      await Promise.race([gate(task.input.name).promise, aborted(runtime.signal)]);
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        ctx,
      );
    },
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

afterEach(async () => {
  gates.clear();
  owned.clear();
  runtimes.clear();
  for await (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function ownedTasksBeforeReopen() {
  const path = await sqlitePath();
  const opened = await openTasks(await openNodeSqliteStorage(path), [Hold, Probe]);
  const root = await opened.harness.root(context);
  opened.harness.resume();
  // The probe owns: two held tasks, one that ends, a grandchild below the first, and a conversation with a task.
  const ids = await root.commit(async (tx) => {
    const probe = await tx.createTask(
      Probe,
      { name: "probe" },
      { ownership: { kind: "conversation" } },
    );
    const first = await tx.createTask(
      Hold,
      { name: "first" },
      { ownership: { kind: "task", taskId: probe } },
    );
    const ends = await tx.createTask(
      Hold,
      { name: "ends" },
      { ownership: { kind: "task", taskId: probe } },
    );
    const second = await tx.createTask(
      Hold,
      { name: "second" },
      { ownership: { kind: "task", taskId: probe } },
    );
    await tx.createTask(
      Hold,
      { name: "grandchild" },
      { ownership: { kind: "task", taskId: first } },
    );
    const child = await tx.createConversation({ ownership: { kind: "task", taskId: probe } });
    await tx.createTask(
      Hold,
      { name: "inside" },
      { ownership: { kind: "conversation" }, conversationId: child.id },
    );
    return { probe, first, ends, second };
  }, context);
  gate("ends").resolve();
  await opened.harness.waitForTask(ids.ends, context);
  return { path, opened, ids };
}

describe("TaskRuntime.ownedTasks", () => {
  it("lists the live tasks a task owns directly, in ID order, also after a reopen", async () => {
    const { path, opened, ids } = await ownedTasksBeforeReopen();
    // The first ends too, but holds its outcome as `completing` while its grandchild runs: still live, so listed.
    gate("first").resolve();
    await eventually(
      async () => (await state(opened.harness, ids.first)).state.status === "completing",
    );
    gate("look.probe").resolve();
    await eventually(() => owned.has("probe"));
    expect(owned.get("probe")).toEqual([ids.first, ids.second]);
    await opened.harness.close(context);

    // After a reopen the rerun sees the same tasks, which an earlier invocation created.
    gates.clear();
    owned.clear();
    const reopened = await openTasks(await openNodeSqliteStorage(path), [Hold, Probe]);
    reopened.harness.resume();
    gate("look.probe").resolve();
    await eventually(() => owned.has("probe"));
    expect(owned.get("probe")).toEqual([ids.first, ids.second]);
    await reopened.harness.close(context);
  });

  it("rejects once its invocation has ended", async () => {
    const opened = await openTasks(await openNodeSqliteStorage(await sqlitePath()), [Hold, Probe]);
    const root = await opened.harness.root(context);
    opened.harness.resume();
    const probe = await root.commit(
      (tx) => tx.createTask(Probe, { name: "probe" }, { ownership: { kind: "conversation" } }),
      context,
    );
    await eventually(() => runtimes.has("probe"));
    const runtime = runtimes.get("probe")!;
    // Aborting joins the run invocation, which has ended by then.
    await opened.harness.abortTask(probe, context);
    await expect(runtime.ownedTasks(context)).rejects.toThrow("invocation has ended");
    await opened.harness.close(context);
  });
});
