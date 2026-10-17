import { defineDoc, defineEntry, defineTask, type EntryId, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { user } from "./harness-support.ts";
import { start, oneStep, openRoot } from "./harness-tasks-support.ts";
import { context } from "./session-support.ts";
import { completed, eventually } from "./task-support.ts";

const Progress = defineDoc<{ lines: string[] }>({
  kind: "test.task-progress",
  version: 1,
  scope: "task",
  initial: () => ({ lines: [] }),
});

const Answer = defineEntry("answer");

function writerTasks() {
  const Child = oneStep("test.child", async (_task, runtime, ctx) => {
    await runtime.commit(() => completed(null), ctx);
  });
  const seen: { childId?: TaskId; progressSeen?: unknown } = {};
  const Writer = defineTask<null, { phase: "write" } | { phase: "answer" }, { entryId: EntryId }>({
    name: "test.writer",
    version: 1,
    initial: () => ({ phase: "write" }),
    phases: {
      write: async (task, runtime, ctx) => {
        expect(await runtime.memo("choice", ctx)).toBeUndefined();
        const winners = await Promise.all([
          runtime.memo("choice", "a", ctx),
          runtime.memo("choice", "b", ctx),
        ]);
        expect(winners).toEqual(["a", "a"]);
        expect(await runtime.memo("choice", ctx)).toBe("a");
        // Memo names never resolve to inherited object properties.
        expect(await runtime.memo("toString", ctx)).toBeUndefined();
        expect(await runtime.memo("toString", "own", ctx)).toBe("own");
        await runtime.commit(async (tx) => {
          (await tx.doc(Progress, task.id)).lines.push("wrote");
          // Task creation defaults to the task's own conversation.
          seen.childId = await tx.createTask(Child, null, { ownership: { kind: "conversation" } });
          return { status: "running", checkpoint: { phase: "answer" } };
        }, ctx);
      },
      answer: async (task, runtime, ctx) => {
        expect(task.memos).toEqual({ choice: "a", toString: "own" });
        await runtime.commit(async (tx) => {
          seen.progressSeen = [...(await tx.doc(Progress, task.id)).lines];
        }, ctx);
        await runtime.commit(async (tx, current) => {
          const entry = await tx.appendEntry(current.conversationId, {
            kind: "answer",
            model: [user("done")],
          });
          return completed({ entryId: entry.id });
        }, ctx);
      },
    },
    abort: async () => {},
  });
  return { Child, seen, Writer };
}

describe("task phases", () => {
  it("continues one invocation through checkpoint progress and completes with a typed result", async () => {
    const seen: number[] = [];
    const runtimes = new Set<unknown>();
    const Counter = defineTask<{ to: number }, { phase: "count"; n: number }, number>({
      name: "test.counter",
      version: 1,
      initial: () => ({ phase: "count", n: 0 }),
      phases: {
        count: async (task, runtime, ctx) => {
          seen.push(task.state.checkpoint.n);
          runtimes.add(runtime);
          await runtime.commit((_tx, current) => {
            const n = current.state.checkpoint.n + 1;
            return n === task.input.to
              ? completed(n)
              : { status: "running", checkpoint: { phase: "count", n } };
          }, ctx);
        },
      },
      abort: async () => {},
    });
    const { harness, root } = await openRoot([Counter]);
    const id = await root.commit(
      (tx) => tx.createTask(Counter, { to: 3 }, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    const receipt = await harness.waitForTask(id, context);
    const result: number | undefined =
      receipt.state.outcome.status === "completed" ? receipt.state.outcome.result : undefined;
    expect(result).toBe(3);
    expect(seen).toEqual([0, 1, 2]);
    expect(runtimes.size).toBe(1);
    await harness.close(context);
  });
});

describe("task phases", () => {
  it("faults a phase without durable progress and a throwing phase", async () => {
    const Idle = oneStep("test.idle", async () => {});
    const DocumentOnly = oneStep("test.document-only", async (_task, runtime, ctx) => {
      // A commit that returns no state is not progress.
      await runtime.commit(() => undefined, ctx);
    });
    const Throws = oneStep("test.throws", () => {
      return Promise.reject(new Error("boom"));
    });
    const { harness, root } = await openRoot([Idle, DocumentOnly, Throws]);
    const ids = [
      await start(root, Idle),
      await start(root, DocumentOnly),
      await start(root, Throws),
    ];
    harness.resume();
    const outcomes = await Promise.all(
      ids.map(async (id) => (await harness.waitForTask(id, context)).state.outcome),
    );
    expect(outcomes).toEqual([
      {
        status: "faulted",
        error: { message: "Task test.idle phase run returned without durable progress" },
      },
      {
        status: "faulted",
        error: { message: "Task test.document-only phase run returned without durable progress" },
      },
      { status: "faulted", error: { message: "boom" } },
    ]);
    await harness.close(context);
  });
});

describe("task phases", () => {
  it("keeps a committed terminal outcome when the handler throws afterwards", async () => {
    let lateCommit: unknown;
    const Done = oneStep<string>("test.done", async (_task, runtime, ctx) => {
      await runtime.commit(() => completed("ok"), ctx);
      lateCommit = await runtime.commit(() => undefined, ctx).catch((error: unknown) => error);
      throw new Error("after terminal");
    });
    const { harness, root } = await openRoot([Done]);
    const id = await start(root, Done);
    harness.resume();
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "completed",
      result: "ok",
    });
    await eventually(() => lateCommit !== undefined);
    expect(String(lateCommit)).toContain(`Task ${id} is terminal`);
    await harness.close(context);
  });
});

describe("task phases", () => {
  it("compares checkpoints by value, including arrays", async () => {
    const Collect = defineTask<null, { phase: "collect"; items: string[] }, null>({
      name: "test.collect",
      version: 1,
      initial: () => ({ phase: "collect", items: [] }),
      phases: {
        collect: async (task, runtime, ctx) => {
          const items = task.state.checkpoint.items;
          // Two rounds of progress, then an equal copy of the checkpoint, which is no progress.
          const next = items.length < 2 ? [...items, `item${items.length}`] : [...items];
          await runtime.commit(
            () => ({ status: "running", checkpoint: { phase: "collect", items: next } }),
            ctx,
          );
        },
      },
      abort: async () => {},
    });
    const { harness, root } = await openRoot([Collect]);
    const id = await root.commit(
      (tx) => tx.createTask(Collect, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "faulted",
      error: { message: "Task test.collect phase collect returned without durable progress" },
    });
    await harness.close(context);
  });
});

describe("task phases", () => {
  it("commits results with entries atomically, keeps memos until terminal, and retires task documents", async () => {
    const { Child, seen, Writer } = writerTasks();
    const { harness, root } = await openRoot([Writer, Child]);
    const conversation = await harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );
    const id = await conversation.commit(
      (tx) => tx.createTask(Writer, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    const receipt = await harness.waitForTask(id, context);
    expect(receipt.state).not.toHaveProperty("checkpoint");
    expect(receipt).not.toHaveProperty("memos");
    const outcome = receipt.state.outcome;
    if (outcome.status !== "completed") throw new Error("expected completion");
    const entry = await harness.commit((tx) => tx.entry(outcome.result.entryId), context);
    expect(Answer.is(entry)).toBe(true);
    expect(entry?.conversationId).toBe(conversation.id);
    expect(seen.progressSeen).toEqual(["wrote"]);
    expect(await harness.snapshot(Progress, id, context)).toBeUndefined();
    expect(await harness.getTask(id, context)).toEqual(receipt);
    expect((await harness.waitForTask(seen.childId!, context)).conversationId).toBe(
      conversation.id,
    );
    expect(root.id).not.toBe(conversation.id);
    await harness.close(context);
  });
});
