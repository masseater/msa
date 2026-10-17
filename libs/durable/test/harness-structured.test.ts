import { rm } from "node:fs/promises";

import { type ConversationId, type TaskId, type TaskOptions } from "@msa/durable";
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
  end,
  type NodeInput,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  Unregistered,
  waitOn,
  parentOf,
  spawn,
  owned,
  script,
  directories,
} from "./harness-structured-support.ts";
import { context } from "./session-support.ts";
import { settled } from "./task-support.ts";

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("task ownership", () => {
  it("creates a child in its owner's conversation with its owner recorded", async () => {
    const { harness, root } = await openNodes();
    let child: TaskId | undefined;
    script("parent", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          child = await spawn(tx, runtime.taskId, "child");
          return waitOn([child], "allSettled");
        }, ctx),
    });
    const parent = await start(root, "parent");
    await until(() => child !== undefined);
    const record = (await harness.getTask(child!, context))!;
    expect(record).toMatchObject({ owner: parent, conversationId: root.id, background: false });
    expect((await harness.getTask(parent, context))!.owner).toBeUndefined();
    open("child");
    expect(await outcomeOf(harness, parent)).toBe("completed");
    await harness.close(context);
  });

  it("rejects no ownership, a missing owner, a child in another conversation, and a background child", async () => {
    const { harness, root } = await openNodes();
    const parent = await start(root, "parent");
    const other = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    const create = (options: TaskOptions) =>
      root.commit((tx) => tx.createTask(Node, { name: "x" }, options), context);
    await expect(create({} as TaskOptions)).rejects.toThrow();
    await expect(create(owned(999_999 as TaskId))).rejects.toThrow("does not exist");
    await expect(create({ ...owned(parent), conversationId: other.id })).rejects.toThrow(
      "owner's conversation",
    );
    await expect(create({ ...owned(parent), background: true })).rejects.toThrow(
      "cannot be background",
    );
    // The owner's conversation is the default, even from a commit bound to another conversation.
    const child = await other.commit((tx) => spawn(tx, parent, "child"), context);
    expect((await harness.getTask(child, context))!.conversationId).toBe(root.id);
    open("parent");
    open("child");
    await harness.waitForTask(parent, context);
    await harness.close(context);
  });
});

describe("task ownership", () => {
  it("rejects new owned work below an owner that is completing, terminal, or abort-marked", async () => {
    const { harness, root } = await openNodes();
    script("parent", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          await spawn(tx, runtime.taskId, "child");
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx);
      },
    });
    const parent = await start(root, "parent");
    await until(async () => (await state(harness, parent)).status === "completing");
    const createChild = () => root.commit((tx) => spawn(tx, parent, "late"), context);
    const createConversation = () =>
      root.commit(
        (tx) => tx.createConversation({ ownership: { kind: "task", taskId: parent } }),
        context,
      );
    await expect(createChild()).rejects.toThrow("is completing");
    await expect(createConversation()).rejects.toThrow("is completing");
    open("child");
    await harness.waitForTask(parent, context);
    await expect(createChild()).rejects.toThrow("is terminal");
    await expect(createConversation()).rejects.toThrow("is terminal");

    script("slow", {
      abort: async (runtime, ctx) => {
        await gate("abort.slow").promise;
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
      },
    });
    const slow = await start(root, "slow");
    await until(() => log.includes("run:slow"));
    await harness.abortTask(slow, context);
    await expect(root.commit((tx) => spawn(tx, slow, "late"), context)).rejects.toThrow(
      "is abort-marked",
    );
    open("abort.slow");
    expect(await outcomeOf(harness, slow)).toBe("aborted");
    await harness.close(context);
  });
});

describe("task ownership", () => {
  it("cannot create a child in its finishing commit, but work it starts in an owned conversation holds it", async () => {
    const { harness, root } = await openNodes();
    script("eager", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          await spawn(tx, runtime.taskId, "never");
          return end("completed", "eager");
        }, ctx),
    });
    const eager = await start(root, "eager");
    expect((await harness.waitForTask(eager, context)).state.outcome).toMatchObject({
      status: "faulted",
      error: { message: expect.stringContaining("is completing") },
    });
    // The rejected commit wrote nothing.
    const nodes = await harness.commit((tx) => tx.scanTasks({ kind: "test.node" }, 20), context);
    expect(nodes.items.map((task) => (task.input as NodeInput).name)).toEqual(["eager"]);

    let child: ConversationId | undefined;
    script("host", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          child = (
            await tx.createConversation({ ownership: { kind: "task", taskId: runtime.taskId } })
          ).id;
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx),
      resume: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          await tx.createTask(
            Node,
            { name: "inner" },
            { ...OWN_CONVERSATION, conversationId: child! },
          );
          return end("completed", "host");
        }, ctx),
    });
    const host = await start(root, "host");
    await until(async () => (await state(harness, host)).status === "completing");
    expect(await settled(harness.waitForTask(host, context))).toBe(false);
    open("inner");
    expect(await outcomeOf(harness, host)).toBe("completed");
    await harness.close(context);
  });
});

async function heldFailureTree() {
  const { harness, root } = await openNodes();
  const found = { ids: [] as TaskId[] };
  script("p1", {
    run: async (runtime, ctx) => {
      await runtime.commit(async (tx) => {
        await spawn(tx, runtime.taskId, "grandchild");
        return { status: "running", checkpoint: { phase: "resume", round: 1 } };
      }, ctx);
    },
    resume: (runtime, ctx) => runtime.commit(() => end("failed", "p1"), ctx),
  });
  script("grandchild", {
    abort: async (runtime, ctx) => {
      await gate("abort.grandchild").promise;
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
    },
  });
  const spawned: { outside?: TaskId } = {};
  script("parent", {
    run: (runtime, ctx) =>
      runtime.commit(async (tx) => {
        for await (const name of ["p1", "p2"])
          found.ids.push(await spawn(tx, runtime.taskId, name));
        spawned.outside = await spawn(tx, runtime.taskId, "outside");
        return waitOn(found.ids, "failFast");
      }, ctx),
  });
  return { harness, root, found, spawned };
}

describe("waiting", () => {
  it("resumes once every awaited task is terminal and reads their outcomes in order (allSettled)", async () => {
    const { harness, root } = await openNodes();
    const found = { ids: [] as TaskId[], outcomes: [] as string[] };
    script("parent", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          for await (const name of ["ok", "fails", "throws", "aborted"])
            found.ids.push(await spawn(tx, runtime.taskId, name));
          found.ids.push(
            await tx.createTask(Unregistered, { name: "orphan" }, owned(runtime.taskId)),
          );
          return waitOn(found.ids, "allSettled");
        }, ctx),
      resume: async (runtime, ctx) => {
        found.outcomes = (await runtime.outcomes(found.ids, ctx)).map((outcome) => outcome.status);
        await runtime.commit(() => end("completed", "parent"), ctx);
      },
    });
    const parent = await start(root, "parent");
    await until(() => found.ids.length === 5);
    await until(async () => (await state(harness, parent)).status === "waiting");
    open("ok");
    open("fails", "failed");
    open("throws", "throw");
    await harness.abortTask(found.ids[3]!, context);
    expect(await harness.abortTask(found.ids[4]!, context)).toBe("marked");
    expect(await outcomeOf(harness, parent)).toBe("completed");
    expect(found.outcomes).toEqual(["completed", "failed", "faulted", "aborted", "orphaned"]);
    // allSettled never marks siblings.
    expect(log.filter((line) => line.startsWith("abort:"))).toEqual(["abort:aborted"]);
    await harness.close(context);
  });
});

describe("waiting", () => {
  for (const ending of ["failed", "throw"] as const) {
    it(`fails fast when a child ends ${ending === "throw" ? "faulted" : "failed"}: its live siblings are aborted, the parent is not`, async () => {
      const { harness, root } = await openNodes();
      const found = parentOf("checkout", ["p1", "p2", "p3", "p4"], "failFast");
      const parent = await start(root, "checkout");
      await until(async () => (await state(harness, parent)).status === "waiting");
      open("p2", ending);
      expect(await outcomeOf(harness, parent)).toBe("completed");
      expect(found.outcomes).toEqual([
        "aborted",
        ending === "throw" ? "faulted" : "failed",
        "aborted",
        "aborted",
      ]);
      expect((await harness.getTask(parent, context))!.abortRequested).toBe(false);
      expect(log.filter((line) => line.startsWith("abort:")).sort()).toEqual([
        "abort:p1",
        "abort:p3",
        "abort:p4",
      ]);
      await harness.close(context);
    });
  }
});

describe("waiting", () => {
  it("fails fast on a held failure before the failing child drains", async () => {
    const { harness, root, found, spawned } = await heldFailureTree();
    const parent = await start(root, "parent");
    await until(() => found.ids.length === 2);
    // p1 holds `failed` while its grandchild's abort handler runs; p2 is already aborted.
    expect(await outcomeOf(harness, found.ids[1]!)).toBe("aborted");
    expect(await state(harness, found.ids[0]!)).toMatchObject({
      status: "completing",
      outcome: { status: "failed" },
    });
    expect((await state(harness, parent)).status).toBe("waiting");
    open("abort.grandchild");
    await until(() => log.includes("resume:parent"));
    // Only the other tasks in `on` are marked: not the failed one, not the parent, not a child outside `on`.
    const marked = async (id: TaskId) => (await harness.getTask(id, context))!.abortRequested;
    expect(await outcomeOf(harness, found.ids[0]!)).toBe("failed");
    expect([
      await marked(found.ids[0]!),
      await marked(found.ids[1]!),
      await marked(spawned.outside!),
    ]).toEqual([false, true, false]);
    expect(await marked(parent)).toBe(false);
    expect((await state(harness, spawned.outside!)).status).toBe("running");
    // Finished, the parent holds for the child outside `on`.
    await until(async () => (await state(harness, parent)).status === "completing");
    open("outside");
    expect(await outcomeOf(harness, parent)).toBe("completed");
    await harness.close(context);
  });
});
