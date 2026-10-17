import { defineTask, type Conversation } from "@msa/durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { countingSetup, ABORTED, DONE, probeTask } from "./harness-context-support.ts";
import { addTask, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

type Read = Parameters<typeof probeTask>[0];

function childReadTask(root: Conversation, read: Read) {
  return defineTask<Record<string, never>, { phase: "run" }, null>({
    name: "test.context-child",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (_task, runtime, taskContext) => {
        await runtime.commit(async (tx) => {
          await tx.appendEntry(root.id, { kind: "message", model: [user("from child")] });
          return undefined;
        }, taskContext);
        await read("child", () => runtime.context(root.id, taskContext), taskContext);
        await runtime.commit(() => DONE, taskContext);
      },
    },
    abort: async (_task, runtime, taskContext) => {
      await runtime.commit(() => ABORTED, taskContext);
    },
  });
}

// Reads, waits on a `Child` task, and reads again.
function parentReadTask(root: Conversation, read: Read, Child: ReturnType<typeof childReadTask>) {
  return defineTask<Record<string, never>, { phase: "start" } | { phase: "after" }, null>({
    name: "test.context-parent",
    version: 1,
    initial: () => ({ phase: "start" }),
    phases: {
      start: async (_task, runtime, taskContext) => {
        await read("parent", () => runtime.context(root.id, taskContext), taskContext);
        await runtime.commit(async (tx) => {
          const child = await tx.createTask(
            Child,
            {},
            { ownership: { kind: "task", taskId: runtime.taskId }, conversationId: root.id },
          );
          return {
            status: "waiting",
            checkpoint: { phase: "after" },
            on: [child],
            policy: "allSettled",
          };
        }, taskContext);
      },
      after: async (_task, runtime, taskContext) => {
        await read("after", () => runtime.context(root.id, taskContext), taskContext);
        await runtime.commit(() => DONE, taskContext);
      },
    },
    abort: async (_task, runtime, taskContext) => {
      await runtime.commit(() => ABORTED, taskContext);
    },
  });
}

describe("conversation context", () => {
  it("keeps a conversation's context read across its tasks and for the retention period once idle", async () => {
    let clock = 1_000;
    const { harness, registry, root, scanned } = await countingSetup({ now: () => clock });
    const rows: Record<string, number> = {};
    const read: Read = async (name, load, taskContext) => {
      const before = scanned.rows;
      const view = await load();
      rows[name] = scanned.rows - before;
      expect(view).toEqual(await root.context(taskContext));
    };
    const Child = childReadTask(root, read);
    const Parent = parentReadTask(root, read, Child);
    const Probe = probeTask(read);
    for (const task of [Child, Parent, Probe]) addTask(registry, task);
    harness.resume();
    const options = { ownership: { kind: "conversation" }, conversationId: root.id } as const;
    const parent = await harness.commit((tx) => tx.createTask(Parent, {}, options), context);
    expect((await harness.waitForTask(parent, context)).state.outcome).toEqual(DONE.outcome);
    await root.waitForIdle(context);
    const probe = async (name: string) => {
      const id = await harness.commit((tx) => tx.createTask(Probe, { name }, options), context);
      expect((await harness.waitForTask(id, context)).state.outcome).toEqual(DONE.outcome);
      await root.waitForIdle(context);
    };
    await probe("idle");
    clock += 600_000;
    await probe("expired");
    // Bounds probes read one row each. The child scans its own new entry; the waiting parent's later invocation and
    // the probe within the retention period scan nothing new. After it, the probe reads the whole transcript again.
    expect(rows).toEqual({ parent: 22, child: 2, after: 1, idle: 1, expired: 23 });
    await harness.close(context);
  });
});
