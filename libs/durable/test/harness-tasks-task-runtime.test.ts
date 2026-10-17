import { defineDoc, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { start, oneStep, withSignal, openRoot } from "./harness-tasks-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { completed, deferred, eventually, settled } from "./task-support.ts";

describe("task runtime", () => {
  it("orders runtime commits against the step: one queued before it lands, one after it rejects", async () => {
    const storage = new ControlledStorage();
    let before: Promise<void> | undefined;
    let after: Promise<void> | undefined;
    let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
    let harnessRef: Awaited<ReturnType<typeof openRoot>>["harness"] | undefined;
    const Detached = oneStep<string>("test.detached", (_task, runtime) => {
      // Hold the line, queue a commit without awaiting it, and return; the step queues behind that commit.
      held = storage.holdCommits();
      void harnessRef!.commit(async (tx) => {
        await tx.appendEntry(runtime.conversationId, { kind: "blocker" });
      }, context);
      before = runtime.commit(() => completed("before"), context);
      // Queued after the handler returned, so after the step.
      setTimeout(() => {
        after = runtime.commit(() => completed("after"), context);
      }, 0);

      return Promise.resolve();
    });
    const { harness, root } = await openRoot([Detached], { storage });
    harnessRef = harness;
    const id = await start(root, Detached);
    harness.resume();
    await eventually(() => held !== undefined);
    await held!.entered;
    await eventually(() => after !== undefined);
    held!.release();
    await before;
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "completed",
      result: "before",
    });
    await expect(after).rejects.toThrow(/invocation has ended|is terminal/u);
    await harness.close(context);
  });
});

describe("task runtime", () => {
  it("stops a watch whose acquisition finishes after the invocation ended", async () => {
    const Notes = defineDoc<{ text: string }>({
      kind: "test.late-watch",
      version: 1,
      scope: "session",
      initial: () => ({ text: "" }),
    });
    const storage = new ControlledStorage();
    let watching: Promise<unknown> | undefined;
    let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
    let harnessRef: Awaited<ReturnType<typeof openRoot>>["harness"] | undefined;
    const Late = oneStep("test.late-watch", (_task, runtime) => {
      held = storage.holdCommits();
      void harnessRef!.commit(async (tx) => {
        await tx.appendEntry(runtime.conversationId, { kind: "blocker" });
      }, context);
      // Starts after the handler returned, so its line job queues behind the step that ends the invocation.
      setTimeout(() => {
        watching = runtime.watchDoc(Notes, context).catch((error: unknown) => error);
      }, 0);

      return Promise.resolve();
    });
    const { harness, root } = await openRoot([Late], { storage });
    harnessRef = harness;
    await harness.commit(async (tx) => {
      (await tx.doc(Notes)).text = "x";
    }, context);
    const id = await start(root, Late);
    harness.resume();
    await eventually(() => held !== undefined);
    await held!.entered;
    await eventually(() => watching !== undefined);
    held!.release();
    expect(String(await watching)).toContain("invocation has ended");
    expect((await harness.waitForTask(id, context)).state.outcome).toMatchObject({
      status: "faulted",
    });
    await harness.close(context);
  });
});

describe("task runtime", () => {
  it("sleeps until the Harness clock reaches the deadline, rechecking after each timer", async () => {
    let clock = 1_000;
    const woke = deferred();
    const Sleeper = oneStep("test.sleeper", async (_task, runtime, ctx) => {
      await runtime.sleep(900, ctx);
      await runtime.sleep(1_005, ctx);
      woke.resolve();
      await runtime.commit(() => completed(null), ctx);
    });
    const { harness, root } = await openRoot([Sleeper], { now: () => clock });
    const id = await start(root, Sleeper);
    harness.resume();
    // The clock stands still, so real timers keep firing without waking the task.
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
    expect(await settled(woke.promise)).toBe(false);
    clock = 1_005;
    await harness.waitForTask(id, context);
    await harness.close(context);
  });
});

describe("task runtime", () => {
  it("rejects a sleep when the invocation is signalled or the sleep's own context is cancelled", async () => {
    const results: string[] = [];
    const sleeping = deferred();
    const Signalled = oneStep("test.sleep-signalled", async (_task, runtime, ctx) => {
      sleeping.resolve();
      await runtime.sleep(Date.now() + 60_000, ctx).catch((error: unknown) => {
        results.push(`signalled:${(error as Error).name}`);
        throw error;
      });
    });
    const Cancelled = oneStep("test.sleep-cancelled", async (_task, runtime, ctx) => {
      const controller = new AbortController();
      const sleeping = runtime.sleep(Date.now() + 60_000, withSignal(controller.signal));
      controller.abort(new Error("stop sleeping"));
      await sleeping.catch((error: unknown) =>
        results.push(`cancelled:${(error as Error).message}`),
      );
      await runtime.commit(() => completed(null), ctx);
    });
    const { harness, root } = await openRoot([Signalled, Cancelled]);
    const signalled = await start(root, Signalled);
    const cancelled = await start(root, Cancelled);
    harness.resume();
    await harness.waitForTask(cancelled, context);
    await sleeping.promise;
    await harness.abortTask(signalled, context);
    expect((await harness.waitForTask(signalled, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "test",
    });
    expect(results).toEqual(["cancelled:stop sleeping", "signalled:AbortError"]);
    await harness.close(context);
  });
});

describe("task scheduling", () => {
  it("fails the Harness on a failed reservation commit; reopening runs the task", async () => {
    let runs = 0;
    const Once = oneStep("test.once", async (_task, runtime, ctx) => {
      runs++;
      await runtime.commit(() => completed(null), ctx);
    });
    const storage = new ControlledStorage();
    const { harness, root, reports } = await openRoot([Once], { storage });
    const id = await start(root, Once);
    const waiting = harness.waitForTask(id, context);
    const failure = new Error("disk gone");
    storage.failNextCommit(failure);
    harness.resume();
    const end = await harness.closed;
    expect(end).toEqual({ reason: "failed", error: failure });
    expect(reports).toEqual([failure]);
    // The pending wait and every later call get SessionFailed with the storage error.
    await expect(waiting).rejects.toMatchObject({ name: "SessionFailed", cause: failure });
    await expect(harness.getTask(id, context)).rejects.toMatchObject({
      name: "SessionFailed",
      cause: failure,
    });
    await expect(root.submit({ type: "input", content: "x" }, context)).rejects.toMatchObject({
      name: "SessionFailed",
    });
    expect(runs).toBe(0);
    await harness.close(context);

    const reopened = await openRoot([Once], { storage: storage.reopen() });
    reopened.harness.resume();
    expect((await reopened.harness.waitForTask(id, context)).state.outcome.status).toBe(
      "completed",
    );
    expect(runs).toBe(1);
    await reopened.harness.close(context);
  });
});

describe("task scheduling", () => {
  it("fails the Harness instead of running a task again when its fault write fails", async () => {
    let runs = 0;
    const storage = new ControlledStorage();
    const failure = new Error("disk gone");
    const Throws = oneStep("test.failed-fault", () => {
      runs++;
      // The next commit is the step's fault write.
      if (runs === 1) storage.failNextCommit(failure);
      return Promise.reject(new Error("boom"));
    });
    const { harness, root, reports } = await openRoot([Throws], { storage });
    const id = await start(root, Throws);
    harness.resume();
    expect(await harness.closed).toEqual({ reason: "failed", error: failure });
    expect(runs).toBe(1);
    expect(reports).toEqual([failure]);
    await harness.close(context);

    // Reopening recovers the task as after a crash: still running, so its phase runs again.
    const reopened = await openRoot([Throws], { storage: storage.reopen() });
    reopened.harness.resume();
    expect((await reopened.harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "faulted",
      error: { message: "boom" },
    });
    expect(runs).toBe(2);
    await reopened.harness.close(context);
  });
});

describe("task scheduling", () => {
  it("waits for Harness and conversation idleness, counting blocked work and ignoring background tasks", async () => {
    const gates = new Map<TaskId, () => void>();
    const Gated = oneStep("test.gated", async (task, runtime, ctx) => {
      await new Promise<void>((resolve) => {
        gates.set(task.id, resolve);
      });
      await runtime.commit(() => completed(null), ctx);
    });
    const { harness, root } = await openRoot([Gated]);
    await harness.waitForIdle(context);
    const other = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    const foreground = await start(root, Gated);
    const background = await start(root, Gated, { background: true });
    const elsewhere = await start(other, Gated);
    // Work that has not started yet is live; cancelling a wait only rejects that wait.
    const cancelled = new AbortController();
    const cancelledWait = harness.waitForIdle(withSignal(cancelled.signal));
    cancelled.abort(new Error("stop waiting"));
    await expect(cancelledWait).rejects.toThrow("stop waiting");
    const aborted = new AbortController();
    aborted.abort(new Error("already cancelled"));
    await expect(root.waitForIdle(withSignal(aborted.signal))).rejects.toThrow("already cancelled");
    harness.resume();
    await eventually(() => gates.size === 3);
    const rootIdle = root.waitForIdle(context);
    const harnessIdle = harness.waitForIdle(context);
    gates.get(foreground)!();
    await rootIdle;
    expect(await settled(harnessIdle)).toBe(false);
    gates.get(elsewhere)!();
    await harnessIdle;
    expect((await harness.getTask(background, context))?.state.status).toBe("running");
    gates.get(background)!();
    await harness.waitForTask(background, context);
    await harness.close(context);
    await expect(harness.waitForIdle(context)).rejects.toThrow("closed");
    await expect(root.waitForIdle(context)).rejects.toThrow("closed");
  });
});
