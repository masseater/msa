import { rm } from "node:fs/promises";

import { type ConversationId, type Harness, type TaskId } from "@msa/durable";
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
  type Opened,
  Unregistered,
  waitOn,
  spawn,
  script,
  directories,
} from "./harness-structured-support.ts";
import { context } from "./session-support.ts";
import { aborted } from "./task-support.ts";

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

// Script `name` to spawn `child` and wait on it; its abort handler records the child's status first.
function chain(harness: () => Harness, name: string, child: string): { id?: TaskId } {
  const found: { id?: TaskId } = {};
  script(name, {
    run: (runtime, ctx) =>
      runtime.commit(async (tx) => {
        found.id = await spawn(tx, runtime.taskId, child);
        return waitOn([found.id], "allSettled");
      }, ctx),
    abort: async (runtime, ctx) => {
      log.push(`${name} saw ${(await harness().getTask(found.id!, context))!.state.status}`);
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
    },
  });
  return found;
}

describe("abort order", () => {
  it("runs abort handlers bottom-up across three levels, each after the level below is terminal", async () => {
    let opened: Opened | undefined;
    const b = chain(() => opened!.harness, "a", "b");
    const c = chain(() => opened!.harness, "b", "c");
    opened = await openNodes();
    const { harness, root } = opened;
    const a = await start(root, "a");
    await until(() => log.includes("run:c"));
    await until(async () => (await state(harness, c.id!)).status === "running");
    expect(await harness.abortTask(a, context)).toBe("marked");
    expect(await outcomeOf(harness, a)).toBe("aborted");
    expect(log.filter((line) => line.startsWith("abort:") || line.includes(" saw "))).toEqual([
      "abort:c",
      "abort:b",
      "b saw terminal",
      "abort:a",
      "a saw terminal",
    ]);
    expect(b.id).toBeDefined();
    await harness.close(context);
  });

  it("does not wait for a task it waits on but does not own", async () => {
    const { harness, root } = await openNodes();
    const other = await start(root, "other");
    script("parent", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([other], "allSettled"), ctx),
    });
    const parent = await start(root, "parent");
    await until(async () => (await state(harness, parent)).status === "waiting");
    await harness.abortTask(parent, context);
    expect(await outcomeOf(harness, parent)).toBe("aborted");
    expect((await state(harness, other)).status).toBe("running");
    open("other");
    await harness.close(context);
  });
});

describe("abort order", () => {
  it("reports an abort-marked task as waiting for its live owned work", async () => {
    const { harness, root } = await openNodes();
    let child: TaskId | undefined;
    script("child", {
      abort: async (runtime, ctx) => {
        await gate("abort.child").promise;
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
      },
    });
    script("parent", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          child = await spawn(tx, runtime.taskId, "child");
          return waitOn([child], "allSettled");
        }, ctx),
    });
    const parent = await start(root, "parent");
    await until(async () => (await state(harness, parent)).status === "waiting");
    await harness.abortTask(parent, context);
    await until(() => log.includes("abort:child"));
    const inspected = (await harness.inspect(context)).tasks.find(
      (task) => task.record.id === parent,
    );
    expect(inspected?.state).toEqual({ kind: "waiting", on: [child] });
    open("abort.child");
    expect(await outcomeOf(harness, parent)).toBe("aborted");
    await harness.close(context);
  });

  it("faults an abort handler that tries to wait", async () => {
    const { harness, root } = await openNodes();
    script("parent", {
      abort: (runtime, ctx) => runtime.commit(() => waitOn([], "allSettled"), ctx),
    });
    const parent = await start(root, "parent");
    await until(() => log.includes("run:parent"));
    await harness.abortTask(parent, context);
    expect((await harness.waitForTask(parent, context)).state.outcome).toMatchObject({
      status: "faulted",
      error: { message: expect.stringContaining("cannot wait") },
    });
    await harness.close(context);
  });
});

describe("abort order", () => {
  it("orphans a blocked task only after its owned work drained", async () => {
    const { harness, root } = await openNodes();
    const { owner, child } = await root.commit(async (tx) => {
      const owner = await tx.createTask(Unregistered, { name: "owner" }, OWN_CONVERSATION);
      return { owner, child: await spawn(tx, owner, "child") };
    }, context);
    await until(() => log.includes("run:child"));
    expect(await harness.abortTask(owner, context)).toBe("marked");
    expect(await outcomeOf(harness, child)).toBe("aborted");
    expect((await harness.waitForTask(owner, context)).state.outcome).toEqual({
      status: "orphaned",
      reason: "missing_task",
    });
    await harness.close(context);
  });
});

describe("abort order", () => {
  it("cascades through task and conversation edges, bottom-up", async () => {
    const { harness, root } = await openNodes();
    let b: TaskId | undefined;
    let x: TaskId | undefined;
    script("a", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          b = await spawn(tx, runtime.taskId, "b");
          return waitOn([b], "allSettled");
        }, ctx),
    });
    script("b", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          const conversation = await tx.createConversation({
            ownership: { kind: "task", taskId: runtime.taskId },
          });
          x = await tx.createTask(
            Node,
            { name: "x" },
            { ...OWN_CONVERSATION, conversationId: conversation.id },
          );
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx);
      },
      resume: async (runtime) => {
        await aborted(runtime.signal);
      },
    });
    const a = await start(root, "a");
    await until(() => log.includes("run:x"));
    await harness.abortTask(a, context);
    expect(await outcomeOf(harness, a)).toBe("aborted");
    expect(await outcomeOf(harness, x!)).toBe("aborted");
    expect(log.filter((line) => line.startsWith("abort:"))).toEqual([
      "abort:x",
      "abort:b",
      "abort:a",
    ]);
    await harness.close(context);
  });
});

describe("boundaries", () => {
  it("keeps background work through Conversation.abort(); { background: true } aborts it and waits", async () => {
    const { harness, root } = await openNodes();
    const foreground = await start(root, "foreground");
    let child: TaskId | undefined;
    let below: TaskId | undefined;
    script("background", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          child = await spawn(tx, runtime.taskId, "child");
          const conversation = await tx.createConversation({
            ownership: { kind: "task", taskId: runtime.taskId },
          });
          below = await tx.createTask(
            Node,
            { name: "below" },
            { ...OWN_CONVERSATION, conversationId: conversation.id },
          );
          return waitOn([child], "allSettled");
        }, ctx);
      },
    });
    const background = await start(root, "background", { ...OWN_CONVERSATION, background: true });
    await until(() => log.includes("run:below") && log.includes("run:child"));
    await root.abort(context);
    expect(await outcomeOf(harness, foreground)).toBe("aborted");
    for await (const id of [background, child!, below!])
      expect((await state(harness, id)).status).not.toBe("terminal");
    await root.abort(context, { background: true });
    for await (const id of [background, child!, below!])
      expect((await state(harness, id)).status).toBe("terminal");
    await harness.close(context);
  });
});

describe("boundaries", () => {
  it("never cascades from a terminal owner: an aborted subagent's conversation runs new work normally", async () => {
    const { harness, root } = await openNodes();
    let conversation: ConversationId | undefined;
    script("agent", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          conversation = (
            await tx.createConversation({ ownership: { kind: "task", taskId: runtime.taskId } })
          ).id;
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx);
      },
      resume: async (runtime) => {
        await aborted(runtime.signal);
      },
    });
    const agent = await start(root, "agent");
    await until(() => log.includes("resume:agent"));
    await harness.abortTask(agent, context);
    expect(await outcomeOf(harness, agent)).toBe("aborted");
    const child = (await harness.conversation(conversation!, context))!;
    const question = await start(child, "question");
    open("question");
    expect(await outcomeOf(harness, question)).toBe("completed");
    await harness.close(context);
  });
});
