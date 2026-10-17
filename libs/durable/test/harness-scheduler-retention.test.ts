import { rm } from "node:fs/promises";

import { LiveDoc, type Storage } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import {
  status,
  sizes,
  subagentCycle,
  gate,
  gates,
  Hold,
  runs,
  directories,
  sqlitePath,
  open,
  rejections,
  Spawner,
} from "./harness-scheduler-retention-support.ts";
import { context } from "./session-support.ts";
import { deferred, eventually, settled } from "./task-support.ts";

afterEach(async () => {
  gates.clear();
  runs.clear();
  rejections.length = 0;
  for await (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

// Count the task and conversation reads a storage serves.
function countReads(storage: Storage): { tasks: number; conversations: number } {
  const reads = { tasks: 0, conversations: 0 };
  const task = storage.task.bind(storage);
  const conversation = storage.conversation.bind(storage);
  storage.task = (id, readContext) => {
    reads.tasks++;
    return task(id, readContext);
  };
  storage.conversation = (id, readContext) => {
    reads.conversations++;
    return conversation(id, readContext);
  };
  return reads;
}

describe("scheduler retention", () => {
  it("forgets ended subagent chains once their work ends", async () => {
    const { harness, root } = await open();
    const parent = await root.commit(
      (tx) => tx.createTask(Hold, { name: "parent" }, { ownership: { kind: "conversation" } }),
      context,
    );
    await subagentCycle(harness, root, parent, 0);
    const baseline = sizes(harness);
    for await (const n of Array.from({ length: 200 }, (_, i) => 1 + i))
      await subagentCycle(harness, root, parent, n);
    expect(sizes(harness)).toEqual(baseline);
    gate("parent").resolve();
    await harness.waitForTask(parent, context);
    await harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("holds a live owner for work later created in a forgotten conversation, loading its chain again", async () => {
    const storage = await openNodeSqliteStorage(await sqlitePath());
    const reads = countReads(storage);
    const { harness, root } = await open(storage);
    // Live P -> ended B -> ended A -> conversation C, empty: forgotten.
    const tree = await root.commit(async (tx) => {
      const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const a = await tx.createTask(
        Hold,
        { name: "a" },
        { ownership: { kind: "task", taskId: b } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: a } });
      return { p, b, a, c: c.id };
    }, context);
    gate("a").resolve();
    gate("b").resolve();
    await harness.waitForTask(tree.b, context);
    const before = sizes(harness);
    const loaded = reads.tasks + reads.conversations;
    const c = (await harness.conversation(tree.c, context))!;
    const d = await c.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    );
    gate("p").resolve();
    await eventually(async () => (await status(harness, tree.p)).status === "completing");
    expect(reads.tasks + reads.conversations).toBeGreaterThan(loaded);
    gate("d").resolve();
    expect((await harness.waitForTask(d, context)).state.outcome.status).toBe("completed");
    expect((await harness.waitForTask(tree.p, context)).state.outcome.status).toBe("completed");
    expect(sizes(harness).settled).toBeLessThanOrEqual(before.settled);
    await harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("holds an owner for work its own terminal commit creates below a forgotten chain", async () => {
    const { harness, root } = await open();
    // Live P (a spawner) -> ended B -> ended A -> conversation C, empty: forgotten. P's terminal commit creates D in C.
    const tree = await root.commit(async (tx) => {
      const p = await tx.createTask(
        Spawner,
        { name: "p", into: 0 },
        { ownership: { kind: "conversation" } },
      );
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const a = await tx.createTask(
        Hold,
        { name: "a" },
        { ownership: { kind: "task", taskId: b } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: a } });
      return { p, b, c: c.id };
    }, context);
    // Point the spawner at C, now that its ID is known.
    await root.commit(async (tx) => {
      const record = (await tx.task(tree.p))!;
      (tx as unknown as { setTask(value: unknown): void }).setTask({
        ...record,
        input: { name: "p", into: tree.c },
      });
    }, context);
    gate("a").resolve();
    gate("b").resolve();
    await harness.waitForTask(tree.b, context);
    gate("p").resolve();
    await eventually(async () => (await status(harness, tree.p)).status !== "running");
    expect((await status(harness, tree.p)).status).toBe("completing");
    gate("inside.p").resolve();
    expect((await harness.waitForTask(tree.p, context)).state.outcome.status).toBe("completed");
    await harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("withdraws an input queued in a forgotten conversation below an abort-marked owner", async () => {
    const { harness, root } = await open();
    // Live P -> ended B -> conversation C with no task; C gets a queued input while P is cancelling.
    const tree = await root.commit(async (tx) => {
      const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      // A live child keeps P holding its abort until the input is withdrawn and the child ends.
      const keep = await tx.createTask(
        Hold,
        { name: "keep" },
        { ownership: { kind: "task", taskId: p } },
      );
      return { p, b, c: c.id, keep };
    }, context);
    gate("b").resolve();
    await harness.waitForTask(tree.b, context);
    const c = (await harness.conversation(tree.c, context))!;
    // Busy, so the input queues instead of starting a run.
    await c.commit(async (tx) => {
      (await tx.doc(LiveDoc, tree.c)).run = { taskId: tree.keep, inputs: [] };
    }, context);
    const queued = (await c.submit({ type: "input", content: "later" }, context)).id;
    await harness.abortTask(tree.p, context);
    await eventually(async () => {
      const settledState = await (await harness.submission(queued, context))!.status(context);
      return settledState.status === "unanswered";
    });
    expect(await (await harness.submission(queued, context))!.status(context)).toMatchObject({
      reason: "aborted",
    });
    await harness.waitForTask(tree.p, context);
    await harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("aborts work created in a forgotten conversation below an abort-marked owner before it runs", async () => {
    const { harness, root } = await open();
    const tree = await root.commit(async (tx) => {
      const p = await tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } });
      const b = await tx.createTask(
        Hold,
        { name: "b" },
        { ownership: { kind: "task", taskId: p } },
      );
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      const keep = await tx.createTask(
        Hold,
        { name: "keep" },
        { ownership: { kind: "task", taskId: p } },
      );
      return { p, b, c: c.id, keep };
    }, context);
    gate("b").resolve();
    await harness.waitForTask(tree.b, context);
    // P cancels; its live child keeps it holding.
    await harness.commit(async (tx) => {
      const record = (await tx.task(tree.p))!;
      (tx as unknown as { setTask(value: unknown): void }).setTask({
        ...record,
        abortRequested: true,
      });
    }, context);
    await eventually(async () => (await harness.getTask(tree.keep, context))!.abortRequested);
    const c = (await harness.conversation(tree.c, context))!;
    const late = await c.commit(
      (tx) => tx.createTask(Hold, { name: "late" }, { ownership: { kind: "conversation" } }),
      context,
    );
    expect((await harness.waitForTask(late, context)).state.outcome.status).toBe("aborted");
    expect(runs.get("late") ?? 0).toBe(0);
    await harness.close(context);
  });
});

describe("scheduler retention", () => {
  it("keeps a scope busy while the chain of new work below a forgotten conversation loads", async () => {
    const path = await sqlitePath();
    const storage = await openNodeSqliteStorage(path);
    const { harness, root } = await open(storage);
    const tree = await root.commit(async (tx) => {
      const b = await tx.createTask(Hold, { name: "b" }, { ownership: { kind: "conversation" } });
      const c = await tx.createConversation({ ownership: { kind: "task", taskId: b } });
      return { b, c: c.id };
    }, context);
    gate("b").resolve();
    await harness.waitForTask(tree.b, context);
    // Hold the chain load's read of C: the second read once holding, after the creating commit's own.
    const read = storage.conversation.bind(storage);
    const held = deferred<void>();
    const reached = deferred<void>();
    let holding = false;
    let readsOfC = 0;
    storage.conversation = async (id, readContext) => {
      if (holding && id === tree.c && ++readsOfC === 2) {
        reached.resolve();
        await held.promise;
      }
      return read(id, readContext);
    };
    const c = (await harness.conversation(tree.c, context))!;
    holding = true;
    await c.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    );
    await reached.promise;
    expect(await settled(harness.waitForIdle(context))).toBe(false);
    held.resolve();
    gate("d").resolve();
    await harness.waitForIdle(context);
    await harness.close(context);
  });
});
