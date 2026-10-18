import { defineTask } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { family } from "./harness-task-graph-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { completed, deferred, openTasks } from "./task-support.ts";

function gatesNever() {
  const never = new Promise<void>(() => {});
  return { child: never, late: never };
}

function memoTask() {
  const gate = deferred();
  const reached = deferred();
  const Memo = defineTask<null, { phase: "work" }, null>({
    name: "test.graph-memo",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: async (_task, runtime, ctx) => {
        await runtime.memo("seen", true, ctx);
        reached.resolve();
        await gate.promise;
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async () => {},
  });
  return { gate, reached, Memo };
}

describe("task graph view", () => {
  it("registers nothing for an acquisition cancelled while it waits for the line", async () => {
    const storage = new ControlledStorage();
    const { harness } = await openTasks(storage, []);
    const root = await harness.root(context);
    await root.commit(
      (tx) =>
        tx.createTask(
          family(gatesNever()).Child,
          { late: false },
          { ownership: { kind: "conversation" } },
        ),
      context,
    );
    const held = storage.holdCommits();
    const blocking = harness.commit(
      (tx) => tx.appendEntry(root.id, { kind: "blocker" }).then(() => {}),
      context,
    );
    await held.entered;
    const controller = new AbortController();
    const cancelled = harness.watchTaskGraph({ ...context, abortSignal: controller.signal });
    controller.abort(new Error("cancelled"));
    held.release();
    await blocking;
    await expect(cancelled).rejects.toThrow("cancelled");
    // No observer kept the mount: each new observer builds a new revision.
    const first = await harness.taskGraph(context);
    const value = first.value;
    first.dispose();
    const second = await harness.taskGraph(context);
    expect(second.value).not.toBe(value);
    expect(second.value).toEqual(value);
    second.dispose();
    await harness.close(context);
  });
});

describe("task graph view", () => {
  it("publishes no revision for a commit that changes no node, and shares one mount between observers", async () => {
    const { gate, reached, Memo } = memoTask();
    const { harness } = await openTasks(new MemoryStorage(), [Memo]);
    const root = await harness.root(context);
    const id = await root.commit(
      (tx) => tx.createTask(Memo, null, { ownership: { kind: "conversation" } }),
      context,
    );
    const first = await harness.taskGraph(context);
    const second = await harness.taskGraph(context);
    expect(second.value).toBe(first.value);
    const updates: string[] = [];
    first.subscribe((value, _context, delivery) => {
      if (delivery.kind === "update") updates.push(value.tasks[String(id)]?.state.status ?? "gone");
    });
    harness.resume();
    await reached.promise;
    await flush();
    // Reservation changed the node; the memo commit did not.
    expect(updates).toEqual(["running"]);
    gate.resolve();
    await harness.waitForTask(id, context);
    await flush();
    expect(updates).toEqual(["running", "gone"]);
    const last = first.value;
    first.dispose();
    second.dispose();
    // No observer is left, so the mount was dropped: a new observer builds a new revision.
    const rebuilt = await harness.taskGraph(context);
    expect(rebuilt.value).toEqual(last);
    expect(rebuilt.value).not.toBe(last);
    rebuilt.dispose();
    await harness.close(context);
  });
});
