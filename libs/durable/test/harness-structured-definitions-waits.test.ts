import { rm } from "node:fs/promises";

import { defineTask, type TaskId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  state,
  outcomeOf,
  open,
  gate,
  gates,
  until,
  start,
  Node,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  waitOn,
  spawn,
  script,
  spawnAndFinish,
  directories,
} from "./harness-structured-support.ts";
import { addTask } from "./harness-support.ts";
import { context } from "./session-support.ts";

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

// A waiter of its own kind, so its definition can be removed or replaced.
function versioned(version: 1 | 2) {
  return defineTask<
    { on: TaskId[] },
    { phase: "wait" } | { phase: "resume" } | { phase: "migrated" },
    string
  >({
    name: "test.versioned",
    version,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: (task, runtime, ctx) =>
        runtime.commit(
          () => ({
            status: "waiting",
            checkpoint: { phase: "resume" },
            on: task.input.on,
            policy: "allSettled",
          }),
          ctx,
        ),
      resume: (_task, runtime, ctx) =>
        runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: "v1" } }),
          ctx,
        ),
      migrated: (_task, runtime, ctx) =>
        runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: "v2" } }),
          ctx,
        ),
    },
    abort: (_task, runtime, ctx) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ...(version === 2
      ? {
          migrate: (input: unknown) => ({
            input: input as { on: TaskId[] },
            checkpoint: { phase: "migrated" as const },
          }),
        }
      : {}),
  });
}

describe("definitions and waits", () => {
  it("keeps a waiting task blocked without its definition and resumes it migrated under a newer one", async () => {
    const { harness, root, registry } = await openNodes();
    const registration = addTask(registry, versioned(1));
    const other = await start(root, "other");
    const waiter = await root.commit(
      (tx) => tx.createTask(versioned(1), { on: [other] }, OWN_CONVERSATION),
      context,
    );
    await until(async () => (await state(harness, waiter)).status === "waiting");
    registration.dispose();
    open("other");
    await harness.waitForTask(other, context);
    const inspected = async () =>
      (await harness.inspect(context)).tasks.find((task) => task.record.id === waiter)?.state;
    expect(await inspected()).toEqual({ kind: "blocked", reason: "missing_task" });
    expect((await state(harness, waiter)).status).toBe("waiting");
    addTask(registry, versioned(2));
    expect((await harness.waitForTask(waiter, context)).state.outcome).toEqual({
      status: "completed",
      result: "v2",
    });
    await harness.close(context);
  });

  it("orphans an aborted waiting task without its definition at once, leaving the task it waits on running", async () => {
    const { harness, root, registry } = await openNodes();
    const registration = addTask(registry, versioned(1));
    const other = await start(root, "other");
    const waiter = await root.commit(
      (tx) => tx.createTask(versioned(1), { on: [other] }, OWN_CONVERSATION),
      context,
    );
    await until(async () => (await state(harness, waiter)).status === "waiting");
    registration.dispose();
    expect(await harness.abortTask(waiter, context)).toBe("marked");
    expect((await state(harness, waiter)).outcome).toEqual({
      status: "orphaned",
      reason: "missing_task",
    });
    expect((await state(harness, other)).status).toBe("running");
    open("other");
    await harness.close(context);
  });
});

describe("definitions and waits", () => {
  it("never migrates a held outcome: a newer definition leaves it and its version alone", async () => {
    const { harness, root, registry, reports } = await openNodes();
    const holder = (version: number) =>
      defineTask<null, { phase: "run" }, string>({
        name: "test.holder",
        version,
        initial: () => ({ phase: "run" }),
        phases: {
          run: async (task, runtime, ctx) => {
            await runtime.commit(async (tx) => {
              await spawn(tx, task.id, "child");
              return undefined;
            }, ctx);
            await runtime.commit(
              () => ({ status: "terminal", outcome: { status: "completed", result: "held" } }),
              ctx,
            );
          },
        },
        abort: (_task, runtime, ctx) =>
          runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
        migrate: () => {
          throw new Error("never migrates");
        },
      });
    addTask(registry, holder(1));
    const parent = await root.commit(
      (tx) => tx.createTask(holder(1), null, OWN_CONVERSATION),
      context,
    );
    await until(async () => (await state(harness, parent)).status === "completing");
    // The same extension name replaces the old one in place.
    addTask(registry, holder(2));
    open("child");
    const settledParent = await harness.waitForTask(parent, context);
    expect(settledParent.state.outcome).toEqual({ status: "completed", result: "held" });
    expect(settledParent.version).toBe(1);
    expect(reports).toEqual([]);
    await harness.close(context);
  });
});

describe("definitions and waits", () => {
  it("treats a held task as live: outcomes() rejects, and a task waiting on it resumes at its final commit", async () => {
    const { harness, root } = await openNodes();
    spawnAndFinish("held", "child");
    const held = await start(root, "held");
    await until(async () => (await state(harness, held)).status === "completing");
    let rejection = "";
    script("reader", {
      run: async (runtime, ctx) => {
        rejection = await runtime.outcomes([held], ctx).then(
          () => "resolved",
          (error: Error) => error.message,
        );
        await runtime.commit(() => waitOn([held], "allSettled"), ctx);
      },
    });
    const reader = await start(root, "reader");
    await until(async () => (await state(harness, reader)).status === "waiting");
    expect(rejection).toBe(`Task ${held} is not terminal`);
    open("child");
    expect(await outcomeOf(harness, reader)).toBe("completed");
    expect(log.indexOf("resume:reader")).toBeGreaterThan(-1);
    await harness.close(context);
  });
});

describe("conversation abort and boundaries", () => {
  it("marks a held completed task with Conversation.abort(): the work below is aborted, the outcome stays", async () => {
    const { harness, root } = await openNodes();
    const child = spawnAndFinish("held", "child");
    const held = await start(root, "held");
    await until(async () => (await state(harness, held)).status === "completing");
    await root.abort(context);
    expect(await outcomeOf(harness, child.id!)).toBe("aborted");
    const record = await harness.waitForTask(held, context);
    expect(record.state.outcome.status).toBe("completed");
    expect(record.abortRequested).toBe(true);
    await harness.close(context);
  });

  it("marks and awaits only the background work reached when { background: true } is admitted", async () => {
    const { harness, root } = await openNodes();
    script("first", {
      abort: async (runtime, ctx) => {
        await gate("abort.first").promise;
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
      },
    });
    const background = { ...OWN_CONVERSATION, background: true };
    const first = await start(root, "first", background);
    await until(() => log.includes("run:first"));
    const aborting = root.abort(context, { background: true });
    await until(async () => (await harness.getTask(first, context))!.abortRequested);
    const later = await start(root, "later", background);
    open("abort.first");
    await aborting;
    expect((await state(harness, later)).status).not.toBe("terminal");
    expect((await harness.getTask(later, context))!.abortRequested).toBe(false);
    await harness.abortTask(later, context);
    await harness.close(context);
  });
});

describe("conversation abort and boundaries", () => {
  it("stops a cascade at an unmarked background task, but not at a marked one", async () => {
    const { harness, root } = await openNodes();
    script("owner", {
      abort: async (runtime, ctx) => {
        await gate("abort.owner").promise;
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
      },
    });
    const tree = await root.commit(async (tx) => {
      const owner = await tx.createTask(Node, { name: "owner" }, OWN_CONVERSATION);
      const outer = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
      const background = await tx.createTask(
        Node,
        { name: "background" },
        { ...OWN_CONVERSATION, conversationId: outer.id, background: true },
      );
      const inner = await tx.createConversation({
        ownership: { kind: "task", taskId: background },
      });
      return { owner, outer: outer.id, background, inner: inner.id };
    }, context);
    await until(() => log.includes("run:owner") && log.includes("run:background"));
    // The owner's abort handler starts at once: background work is not its ordinary owned work.
    await harness.abortTask(tree.owner, context);
    await until(() => log.includes("abort:owner"));
    const inner = (await harness.conversation(tree.inner, context))!;
    const outer = (await harness.conversation(tree.outer, context))!;
    const shielded = await start(inner, "shielded");
    const exposed = await start(outer, "exposed");
    expect(await outcomeOf(harness, exposed)).toBe("aborted");
    expect((await harness.getTask(shielded, context))!.abortRequested).toBe(false);
    // Marked directly, the background task cascades into its own subtree.
    await harness.abortTask(tree.background, context);
    expect(await outcomeOf(harness, shielded)).toBe("aborted");
    expect(await outcomeOf(harness, tree.background)).toBe("aborted");
    open("abort.owner");
    expect(await outcomeOf(harness, tree.owner)).toBe("aborted");
    await harness.close(context);
  });
});
