import type { Context } from "@msa/chord";
import { defineTask, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import {
  start,
  oneStep,
  type StepRuntime,
  gated,
  withSignal,
  openRoot,
  markDurably,
} from "./harness-tasks-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { aborted, abortedWith, completed, deferred, eventually } from "./task-support.ts";

describe("task scheduling", () => {
  // #10546
  it("pages the newest tasks first without scanning older ones", async () => {
    const Idle = oneStep("test.idle", async () => {});
    const { harness, root } = await openRoot([Idle]);
    const ids: TaskId[] = [];
    for await (const _ of Array.from({ length: 5 })) ids.push(await start(root, Idle));
    const first = await harness.commit((tx) => tx.scanTasks({ order: "descending" }, 2), context);
    expect(first.items.map(({ id }) => id)).toEqual([ids[4], ids[3]]);
    const second = await harness.commit((tx) => tx.scanTasks({}, 2, first.next), context);
    expect(second.items.map(({ id }) => id)).toEqual([ids[2], ids[1]]);
    await harness.close(context);
  });

  it("rejects unknown tasks and reports terminal tasks", async () => {
    const Done = oneStep("test.quick", async (_task, runtime, ctx) => {
      await runtime.commit(() => completed(null), ctx);
    });
    const { harness, root } = await openRoot([Done]);
    const unknown = 999_999 as TaskId;
    expect(await harness.getTask(unknown, context)).toBeUndefined();
    await expect(harness.waitForTask(unknown, context)).rejects.toThrow("does not exist");
    await expect(harness.abortTask(unknown, context)).rejects.toThrow("does not exist");
    const id = await start(root, Done);
    harness.resume();
    await harness.waitForTask(id, context);
    expect(await harness.waitForTask(id, context)).toMatchObject({ state: { status: "terminal" } });
    expect(await harness.abortTask(id, context)).toBe("terminal");
    await harness.close(context);
    expect(() => harness.resume()).toThrow("closed");
  });
});

describe("task scheduling", () => {
  it("rejects task waits cancelled or closed while queued on the line, and pending waits on close", async () => {
    const gate = deferred();
    const Blocking = gated("test.wait-close", gate.promise);
    const storage = new ControlledStorage();
    const { harness, root } = await openRoot([Blocking], { storage });
    const id = await start(root, Blocking);

    // Hold the line with a commit, then queue waits behind it.
    const held = storage.holdCommits();
    const blocker = harness.commit(async (tx) => {
      await tx.appendEntry(root.id, { kind: "blocker" });
    }, context);
    await held.entered;
    const controller = new AbortController();
    const cancelledWhileQueued = harness.waitForTask(id, withSignal(controller.signal));
    controller.abort(new Error("wait cancelled"));
    held.release();
    await blocker;
    await expect(cancelledWhileQueued).rejects.toThrow("wait cancelled");

    const pending = harness.waitForTask(id, context);
    const idle = harness.waitForIdle(context);
    const conversationIdle = root.waitForIdle(context);
    await flush();
    const heldAgain = storage.holdCommits();
    const blockerAgain = harness.commit(async (tx) => {
      await tx.appendEntry(root.id, { kind: "blocker" });
    }, context);
    await heldAgain.entered;
    const closedWhileQueued = harness.waitForTask(id, context);
    const closing = harness.close(context);
    heldAgain.release();
    await blockerAgain;
    await expect(closedWhileQueued).rejects.toThrow("closed");
    await expect(pending).rejects.toThrow("closed");
    await expect(idle).rejects.toThrow("closed");
    await expect(conversationIdle).rejects.toThrow("closed");
    gate.resolve();
    await closing;
  });
});

function markedTask() {
  const reached = deferred();
  const errors: string[] = [];
  const seen: { memoRead?: unknown; runRuntime?: unknown } = {};
  const abortRuntimes: unknown[] = [];
  const Marked = oneStep(
    "test.marked",
    async (_task, runtime, ctx) => {
      seen.runRuntime = runtime;
      await runtime.memo("kept", 1, ctx);
      reached.resolve();
      // Keep working after the signal: every later write of this run must reject.
      await aborted(runtime.signal).catch(() => {});
      seen.memoRead = await runtime.memo("kept", context);
      await runtime
        .memo("late", 2, context)
        .catch((error: unknown) => errors.push((error as Error).message));
      await runtime
        .commit(() => completed(null), context)
        .catch((error: unknown) => {
          errors.push((error as Error).message);
        });
    },
    async (runtime, ctx) => {
      abortRuntimes.push(runtime);
      await runtime.commit((_tx, current) => {
        expect(current.abortRequested).toBe(true);
        expect(current.memos).toEqual({ kept: 1 });
        return abortedWith("mark");
      }, ctx);
    },
  );
  return { reached, errors, seen, abortRuntimes, Marked };
}

describe("task abort", () => {
  it("rejects the run's commits and memo writes after the mark, and settles through a fresh abort invocation", async () => {
    const { reached, errors, seen, abortRuntimes, Marked } = markedTask();
    const { harness, root } = await openRoot([Marked]);
    const id = await start(root, Marked);
    harness.resume();
    await reached.promise;
    expect(await harness.abortTask(id, context)).toBe("marked");
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "mark",
    });
    expect(seen.memoRead).toBe(1);
    expect(errors).toEqual([
      `Task ${id} has a durable abort mark`,
      `Task ${id} has a durable abort mark`,
    ]);
    expect(abortRuntimes).toHaveLength(1);
    expect(abortRuntimes[0]).not.toBe(seen.runRuntime);
    await harness.close(context);
  });
});

describe("task abort", () => {
  it("starts no further phase after a mark that lands during a phase with progress", async () => {
    const reached = deferred();
    const proceed = deferred();
    const phases: string[] = [];
    const Two = defineTask<null, { phase: "one" } | { phase: "two" }, null>({
      name: "test.mark-boundary",
      version: 1,
      initial: () => ({ phase: "one" }),
      phases: {
        one: async (_task, runtime, ctx) => {
          phases.push("one");
          await runtime.commit(() => ({ status: "running", checkpoint: { phase: "two" } }), ctx);
          reached.resolve();
          // Ignores the signal and returns normally after the mark.
          await proceed.promise;
        },
        two: () => {
          phases.push("two");

          return Promise.resolve();
        },
      },
      abort: async (_task, runtime, ctx) => {
        phases.push("abort");
        await runtime.commit(() => abortedWith("boundary"), ctx);
      },
    });
    const { harness, root } = await openRoot([Two]);
    const id = await root.commit(
      (tx) => tx.createTask(Two, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    await reached.promise;
    const { aborting } = await markDurably(harness, id);
    proceed.resolve();
    expect(await aborting).toBe("marked");
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "boundary",
    });
    expect(phases).toEqual(["one", "abort"]);
    await harness.close(context);
  });
});

describe("task abort", () => {
  it("signals and joins the run before returning, then runs the abort handler", async () => {
    const reached = deferred();
    let runEnded = false;
    const Signalled = oneStep("test.signalled", async (_task, runtime) => {
      reached.resolve();
      try {
        await aborted(runtime.signal);
      } finally {
        runEnded = true;
      }
    });
    const { harness, root } = await openRoot([Signalled]);
    const id = await start(root, Signalled);
    harness.resume();
    await reached.promise;
    expect(await harness.abortTask(id, context)).toBe("marked");
    expect(runEnded).toBe(true);
    expect(await harness.abortTask(id, context)).toBe("marked");
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "test",
    });
    await harness.close(context);
  });
});

describe("task abort", () => {
  it("aborts waiting work before its wait ends and faults abort handlers that throw or settle nothing", async () => {
    const gate = deferred();
    const First = gated("test.dependency", gate.promise);
    let first: TaskId | undefined;
    const wait = async (
      _task: unknown,
      runtime: StepRuntime<null>,
      ctx: Context,
    ): Promise<void> => {
      const checkpoint = { phase: "run" } as const;
      await runtime.commit(
        () => ({ status: "waiting", checkpoint, on: [first!], policy: "allSettled" }),
        ctx,
      );
    };
    const Lazy = oneStep("test.lazy-abort", wait, async () => {});
    const Throwing = oneStep("test.throwing-abort", wait, () => {
      return Promise.reject(new Error("abort failed"));
    });
    const { harness, root } = await openRoot([First, Lazy, Throwing]);
    first = await start(root, First);
    const lazy = await start(root, Lazy);
    const throwing = await start(root, Throwing);
    harness.resume();
    await eventually(
      async () => (await harness.getTask(throwing, context))?.state.status === "waiting",
    );
    await eventually(
      async () => (await harness.getTask(lazy, context))?.state.status === "waiting",
    );
    await harness.abortTask(lazy, context);
    await harness.abortTask(throwing, context);
    expect((await harness.waitForTask(lazy, context)).state.outcome).toEqual({
      status: "faulted",
      error: { message: `Abort handler of task ${lazy} returned without a terminal outcome` },
    });
    expect((await harness.waitForTask(throwing, context)).state.outcome).toEqual({
      status: "faulted",
      error: { message: "abort failed" },
    });
    expect((await harness.getTask(first, context))?.state.status).toBe("running");
    gate.resolve();
    await harness.waitForTask(first, context);
    await harness.close(context);
  });
});
