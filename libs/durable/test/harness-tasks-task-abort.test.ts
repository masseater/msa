import { defineDoc, defineTask } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { start, oneStep, withSignal, openRoot, markDurably } from "./harness-tasks-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { abortMarked, aborted, abortedWith, deferred, eventually } from "./task-support.ts";

describe("task abort", () => {
  it("does not signal a running abort handler when aborted again, and a cancelled caller leaves the mark durable", async () => {
    const reached = deferred();
    const proceed = deferred();
    const runRelease = deferred();
    let abortSignalled: boolean | undefined;
    let aborts = 0;
    const Run = oneStep(
      "test.abort-again",
      async () => {
        // Ignores the signal, so the first caller is still joining when it gives up.
        await runRelease.promise;
      },
      async (runtime, ctx) => {
        aborts++;
        reached.resolve();
        await proceed.promise;
        abortSignalled = runtime.signal.aborted;
        await runtime.commit(() => abortedWith("once"), ctx);
      },
    );
    const { harness, root } = await openRoot([Run]);
    const id = await start(root, Run);
    harness.resume();
    await flush();
    // This caller gives up while joining; the mark and the abort invocation are unaffected.
    const controller = new AbortController();
    const cancelled = harness.abortTask(id, withSignal(controller.signal));
    await abortMarked(harness, id);
    controller.abort(new Error("caller gave up"));
    await expect(cancelled).rejects.toThrow("caller gave up");
    runRelease.resolve();
    await reached.promise;
    expect(await harness.abortTask(id, context)).toBe("marked");
    proceed.resolve();
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "once",
    });
    expect(abortSignalled).toBe(false);
    expect(aborts).toBe(1);
    await harness.close(context);
  });
});

describe("task abort", () => {
  it("keeps a terminal outcome committed by an abort handler that throws afterwards", async () => {
    const Run = oneStep(
      "test.abort-then-throw",
      async (_task, runtime) => {
        await aborted(runtime.signal);
      },
      async (runtime, ctx) => {
        await runtime.commit(() => abortedWith("done"), ctx);
        throw new Error("after terminal");
      },
    );
    const { harness, root } = await openRoot([Run]);
    const id = await start(root, Run);
    harness.resume();
    await flush();
    await harness.abortTask(id, context);
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "done",
    });
    await harness.close(context);
  });

  it("never starts phase one when the abort lands while the reservation settles", async () => {
    let ran = false;
    const Reserved = oneStep("test.reserved", async (_task, runtime) => {
      ran = true;
      await aborted(runtime.signal);
    });
    const storage = new ControlledStorage();
    const { harness, root } = await openRoot([Reserved], { storage });
    const id = await start(root, Reserved);
    const held = storage.holdCommits();
    harness.resume();
    await held.entered;
    // The reservation commit is in storage; the abort mark commit queues behind it.
    const aborting = harness.abortTask(id, context);
    held.release();
    expect(await aborting).toBe("marked");
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "test",
    });
    expect(ran).toBe(false);
    await harness.close(context);
  });
});

describe("task abort", () => {
  it("lets an abort mark win over a fault that races it", async () => {
    const storage = new ControlledStorage();
    let marking: Promise<unknown> | undefined;
    let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
    let harnessRef: Awaited<ReturnType<typeof openRoot>>["harness"] | undefined;
    const Racing = oneStep("test.racing-fault", async (task) => {
      held = storage.holdCommits();
      marking = harnessRef!.abortTask(task.id, context);
      await held.entered;
      // The mark is in storage but not committed when the handler throws, so the fault commit queues behind it.
      throw new Error("would fault");
    });
    const { harness, root } = await openRoot([Racing], { storage });
    harnessRef = harness;
    const id = await start(root, Racing);
    harness.resume();
    await eventually(() => held !== undefined);
    await held!.entered;
    await flush();
    held!.release();
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "test",
    });
    expect(await marking).toBe("marked");
    await harness.close(context);
  });
});

function twoPhaseTask() {
  const reached = deferred();
  const proceed = deferred();
  const phases: string[] = [];
  const seen: { abortRan: boolean } = { abortRan: false };
  const Two = defineTask<null, { phase: "one" } | { phase: "two" }, null>({
    name: "test.two",
    version: 1,
    initial: () => ({ phase: "one" }),
    phases: {
      one: async (_task, runtime, ctx) => {
        phases.push("one");
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "two" } }), ctx);
        reached.resolve();
        // Ignores signals and returns normally once released; the closing rule wins over the next phase.
        await proceed.promise;
      },
      two: () => {
        phases.push("two");

        return Promise.resolve();
      },
    },
    abort: () => {
      seen.abortRan = true;

      return Promise.resolve();
    },
  });
  return { reached, proceed, phases, seen, Two };
}

describe("task close", () => {
  it("stops without outcomes and starts no fresh phase or abort invocation while closing", async () => {
    const { reached, proceed, phases, seen, Two } = twoPhaseTask();
    const storage = new ControlledStorage();
    const { harness, root } = await openRoot([Two], { storage });
    const id = await root.commit(
      (tx) => tx.createTask(Two, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    await reached.promise;
    const { aborting } = await markDurably(harness, id);
    const record = await harness.getTask(id, context);
    const commits = storage.commits.length;
    const closing = harness.close(context);
    proceed.resolve();
    await closing;
    expect(await aborting).toBe("marked");
    expect(storage.commits.length).toBe(commits);
    expect(phases).toEqual(["one"]);
    expect(seen.abortRan).toBe(false);
    expect(record).toMatchObject({
      abortRequested: true,
      state: { status: "running", checkpoint: { phase: "two" } },
    });
    await expect(harness.commit(() => {}, context)).rejects.toThrow("closed");
  });
});

describe("task close", () => {
  it("seals admission before signalling handlers and stops watches before joining them", async () => {
    const Notes = defineDoc<{ text: string }>({
      kind: "test.close-notes",
      version: 1,
      scope: "session",
      initial: () => ({ text: "" }),
    });
    const reached = deferred();
    let fromListener: Promise<unknown> | undefined;
    let harnessRef: Awaited<ReturnType<typeof openRoot>>["harness"] | undefined;
    let watchEnd: unknown;
    const Stubborn = oneStep("test.stubborn", async (_task, runtime) => {
      // Uses a context close does not cancel, then waits for the watch to close.
      const watch = await runtime.watchDoc(Notes, context);
      runtime.signal.addEventListener("abort", () => {
        fromListener = harnessRef!.commit(() => {}, context);
      });
      reached.resolve();
      watchEnd = await watch!.closed;
    });
    const { harness, root } = await openRoot([Stubborn]);
    harnessRef = harness;
    await harness.commit(async (tx) => {
      (await tx.doc(Notes)).text = "x";
    }, context);
    await start(root, Stubborn);
    harness.resume();
    await reached.promise;
    await harness.close(context);
    await expect(fromListener).rejects.toThrow("closed");
    expect(watchEnd).toEqual({ reason: "session_closed" });
  });
});

describe("task close", () => {
  it("writes no fault when close seals while the step after a failed phase is queued", async () => {
    const storage = new ControlledStorage();
    let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
    let harnessRef: Awaited<ReturnType<typeof openRoot>>["harness"] | undefined;
    const Throws = oneStep("test.close-fault", (_task, runtime) => {
      held = storage.holdCommits();
      void harnessRef!.commit(async (tx) => {
        await tx.appendEntry(runtime.conversationId, { kind: "blocker" });
      }, context);
      return Promise.reject(new Error("would fault"));
    });
    const { harness, root } = await openRoot([Throws], { storage });
    harnessRef = harness;
    const id = await start(root, Throws);
    harness.resume();
    await eventually(() => held !== undefined);
    await held!.entered;
    await flush();
    const closing = harness.close(context);
    held!.release();
    await closing;
    const taskWrites = storage.commits.flatMap((writes) =>
      writes.filter((write) => write.type === "task" && write.value.id === id),
    );
    expect(
      taskWrites.map((write) => (write.type === "task" ? write.value.state.status : "")),
    ).toEqual(["pending", "running"]);
  });
});
