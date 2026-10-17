import type { Context } from "@msa/chord";
import { withCancel } from "@msa/chord/context";
import { defineDoc, defineTask, type TaskRuntime } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { addHooks, user } from "./harness-support.ts";
import { start, oneStep, type StepRuntime, openRoot } from "./harness-tasks-support.ts";
import { context, flush } from "./session-support.ts";
import { completed, deferred } from "./task-support.ts";

function pingPhases() {
  type PingHooks = { ping(): void };
  const pings: string[] = [];
  const seen: { phase: string; pings: string[]; thinking: string; same?: boolean }[] = [];
  const beforeUse = deferred();
  const afterUse = deferred();
  const waitingBeforeUse = deferred();
  const waitingAfterUse = deferred();
  const ping = async (runtime: TaskRuntime<null, { phase: string }, null, PingHooks>) => {
    pings.length = 0;
    await runtime.hooks.each("ping", (handler) => handler());
    return [...pings];
  };
  const Phases = defineTask<null, { phase: "a" } | { phase: "b" }, null, PingHooks>({
    name: "test.agent-phases",
    version: 1,
    initial: () => ({ phase: "a" }),
    phases: {
      a: async (_task, runtime, ctx) => {
        waitingBeforeUse.resolve();
        await beforeUse.promise;
        const first = await runtime.agent(ctx);
        seen.push({ phase: "a", pings: await ping(runtime), thinking: first.thinkingLevel });
        waitingAfterUse.resolve();
        await afterUse.promise;
        const second = await runtime.agent(ctx);
        seen.push({
          phase: "a",
          pings: await ping(runtime),
          thinking: second.thinkingLevel,
          same: second === first,
        });
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "b" } }), ctx);
      },
      b: async (_task, runtime, ctx) => {
        const agent = await runtime.agent(ctx);
        seen.push({ phase: "b", pings: await ping(runtime), thinking: agent.thinkingLevel });
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async () => {},
  });
  return { pings, seen, beforeUse, afterUse, waitingBeforeUse, waitingAfterUse, Phases };
}

describe("task phases", () => {
  it("resolves the agent at first use in a phase from its snapshot, keeps it for the phase, and anew at the next", async () => {
    const { pings, seen, beforeUse, afterUse, waitingBeforeUse, waitingAfterUse, Phases } =
      pingPhases();
    const { harness, registry, root } = await openRoot([Phases]);
    addHooks(registry, Phases, { ping: () => void pings.push("before") });
    const id = await root.commit(
      (tx) => tx.createTask(Phases, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();

    // Configured during the phase but before its first use: the lazy resolution reads it.
    await waitingBeforeUse.promise;
    await root.configure({ thinkingLevel: "low" }, context);
    beforeUse.resolve();
    // Configured and installed after the first use: not seen until the next phase.
    await waitingAfterUse.promise;
    addHooks(registry, Phases, { ping: () => void pings.push("late") });
    await root.configure({ thinkingLevel: "high" }, context);
    afterUse.resolve();

    await harness.waitForTask(id, context);
    expect(seen).toEqual([
      { phase: "a", pings: ["before"], thinking: "low" },
      { phase: "a", pings: ["before"], thinking: "low", same: true },
      { phase: "b", pings: ["before", "late"], thinking: "high" },
    ]);
    await harness.close(context);
  });

  it("rejects an agent() wait whose caller context is cancelled, without affecting the phase's resolution", async () => {
    let cancelled: unknown;
    let resolved: string | undefined;
    const Agent = oneStep("test.agent-cancel", async (_task, runtime, ctx) => {
      const caller = withCancel(ctx);
      caller.cancel(new Error("caller gone"));
      cancelled = await runtime.agent(caller.context).catch((error: unknown) => error);
      resolved = (await runtime.agent(ctx)).thinkingLevel;
      await runtime.commit(() => completed(null), ctx);
    });
    const { harness, root } = await openRoot([Agent]);
    await harness.waitForTask(await start(root, Agent), context);
    expect(cancelled).toMatchObject({ message: "caller gone" });
    expect(resolved).toBe("off");
    await harness.close(context);
  });
});

describe("task phases", () => {
  it("observes a failed agent resolution whose only caller stopped waiting", async () => {
    let fail = false;
    const settings = {
      get extensions(): undefined {
        if (fail) throw new Error("settings broke");
        return undefined;
      },
    };
    let resolved: unknown;
    const Agent = oneStep("test.agent-failure", async (_task, runtime, ctx) => {
      const caller = withCancel(ctx);
      caller.cancel(new Error("caller gone"));
      fail = true;
      await runtime.agent(caller.context).catch(() => {});
      // Let an unobserved rejection surface before the task ends.
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      resolved = await runtime.agent(ctx).catch((error: unknown) => error);
      await runtime.commit(() => completed(null), ctx);
    });
    const { harness, root } = await openRoot([Agent], { settings });
    await harness.waitForTask(await start(root, Agent), context);
    expect(resolved).toMatchObject({ message: "settings broke" });
    await harness.close(context);
  });
});

function watcherTask() {
  const Notes = defineDoc<{ text: string }>({
    kind: "test.task-notes",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const seen: {
    captured?: StepRuntime<null>;
    watchClosed?: Promise<unknown>;
    absent: unknown;
    handlerContext?: Context;
  } = { absent: "unset" };
  const delivered: string[] = [];
  const Absent = defineDoc<{ text: string }>({
    kind: "test.task-absent",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const Watcher = oneStep("test.watcher", async (_task, runtime, ctx) => {
    seen.captured = runtime;
    seen.handlerContext = ctx;
    seen.absent = await runtime.watchDoc(Absent, ctx);
    const watch = await runtime.watchDoc(Notes, ctx);
    watch!.start((value) => {
      delivered.push(value?.text ?? "retired");

      return Promise.resolve();
    });
    seen.watchClosed = watch!.closed;
    await runtime.commit(() => completed(null), ctx);
  });
  return { Notes, seen, delivered, Watcher };
}

describe("task runtime", () => {
  it("rejects runtime operations after the invocation ends and stops its watches", async () => {
    const { Notes, seen, delivered, Watcher } = watcherTask();
    const { harness, root } = await openRoot([Watcher]);
    await harness.commit(async (tx) => {
      (await tx.doc(Notes)).text = "hello";
    }, context);
    const id = await start(root, Watcher);
    harness.resume();
    await harness.waitForTask(id, context);
    expect(seen.absent).toBeUndefined();
    // The watch stops when the step after the phase ends the invocation; later commits deliver nothing.
    expect(await seen.watchClosed).toEqual({ reason: "stopped" });
    await harness.commit(async (tx) => {
      (await tx.doc(Notes)).text = "after";
    }, context);
    await flush();
    expect(delivered).toEqual([]);
    const runtime = seen.captured!;
    await expect(runtime.commit(() => {}, context)).rejects.toThrow("invocation has ended");
    await expect(runtime.memo("x", context)).rejects.toThrow("invocation has ended");
    await expect(runtime.memo("x", 1, context)).rejects.toThrow("invocation has ended");
    await expect(runtime.sleep(0, context)).rejects.toThrow("invocation has ended");
    await expect(runtime.watchDoc(Notes, context)).rejects.toThrow("invocation has ended");
    // The handler's own context is cancelled by now; the ended invocation still wins.
    await expect(runtime.agent(seen.handlerContext!)).rejects.toThrow("invocation has ended");
    expect(() => runtime.now()).toThrow("invocation has ended");
    expect(() => runtime.report(new Error("late"))).toThrow("invocation has ended");
    await harness.close(context);
  });
});

describe("task runtime", () => {
  it("reads committed documents and context through the runtime, and forwards the clock and reports", async () => {
    const Notes = defineDoc<{ text: string }>({
      kind: "test.runtime-notes",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({ text: "" }),
    });
    let captured: StepRuntime<null> | undefined;
    const seen: unknown[] = [];
    const Reader = oneStep("test.reader", async (_task, runtime, ctx) => {
      captured = runtime;
      const [first, second] = [...(await runtime.context(runtime.conversationId, ctx)).entries].map(
        (entry) => entry.id,
      );
      seen.push((await runtime.snapshot(Notes, runtime.conversationId, ctx))?.text);
      seen.push((await runtime.snapshotAsOf(Notes, runtime.conversationId, first!, ctx))?.text);
      seen.push(
        (await runtime.context(runtime.conversationId, ctx, { at: first! })).entries.length,
      );
      seen.push(
        (await runtime.context(runtime.conversationId, ctx, { at: second! })).messages.length,
      );
      seen.push(runtime.now());
      runtime.report(new Error("reported"));
      await runtime.commit(() => completed(null), ctx);
    });
    const { harness, root, reports } = await openRoot([Reader], { now: () => 1234 });
    for await (const text of ["one", "two"]) {
      await root.commit(async (tx) => {
        (await tx.doc(Notes, root.id)).text = text;
        await tx.appendEntry(root.id, { kind: "message", model: [user(text)] });
      }, context);
    }
    const id = await start(root, Reader);
    harness.resume();
    await harness.waitForTask(id, context);
    expect(seen).toEqual(["two", "one", 1, 2, 1234]);
    expect(reports).toEqual([new Error("reported")]);
    // The step after the phase ends the invocation.
    await flush();
    await expect(captured!.snapshot(Notes, root.id, context)).rejects.toThrow(
      "invocation has ended",
    );
    await expect(captured!.context(root.id, context)).rejects.toThrow("invocation has ended");
    await harness.close(context);
  });
});
