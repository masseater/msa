import { rm } from "node:fs/promises";

import { type ConversationId, defineDoc, type TaskId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  Node,
  end,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  waitOn,
  spawn,
  script,
  directories,
} from "./harness-structured-support.ts";
import { context } from "./session-support.ts";
import { deferred, settled } from "./task-support.ts";

const TaskNotes = defineDoc<{ text: string }>({
  kind: "test.task-notes",
  version: 1,
  scope: "task",
  initial: () => ({ text: "" }),
});

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("waiting", () => {
  // #10411
  it("follows no wait of an abort-marked task, which waits only for its owned work", async () => {
    const { harness, root } = await openNodes();
    const ids: Record<string, TaskId> = {};
    const cleanup = deferred();
    // b owns c and waits on a; aborting b leaves c's cleanup pending, so b waits only for c.
    script("b", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          ids["c"] = await spawn(tx, runtime.taskId, "c");
          return waitOn([ids["a"]!], "allSettled");
        }, ctx),
    });
    script("c", {
      abort: async (runtime, ctx) => {
        await cleanup.promise;
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted", result: "c" } }),
          ctx,
        );
      },
    });
    const aWaits = deferred();
    script("a", {
      run: async (runtime, ctx) => {
        await aWaits.promise;
        await runtime.commit(() => waitOn([ids["b"]!], "allSettled"), ctx);
      },
      resume: (runtime, ctx) => runtime.commit(() => end("completed", "a"), ctx),
    });
    await root.commit(async (tx) => {
      ids["a"] = await tx.createTask(Node, { name: "a" }, OWN_CONVERSATION);
      ids["b"] = await tx.createTask(Node, { name: "b" }, OWN_CONVERSATION);
    }, context);
    await until(async () => (await state(harness, ids["b"]!)).status === "waiting");
    expect(await harness.abortTask(ids["b"]!, context)).toBe("marked");
    await until(() => log.includes("abort:c"));
    // a -> b would close a -> b -> a through b's stale wait; b now waits only for c.
    aWaits.resolve();
    await until(async () => (await state(harness, ids["a"]!)).status === "waiting");
    cleanup.resolve();
    expect(await outcomeOf(harness, ids["b"]!)).toBe("aborted");
    expect(await outcomeOf(harness, ids["a"]!)).toBe("completed");
    await harness.close(context);
  });
});

describe("waiting", () => {
  // #10411
  it("rejects a longer cycle of waits", async () => {
    const { harness, root } = await openNodes();
    const ids: Record<string, TaskId> = {};
    const names = ["x", "y", "z"];
    for (const [index, name] of names.entries()) {
      const next = names[(index + 1) % names.length]!;
      script(name, {
        run: (runtime, ctx) => runtime.commit(() => waitOn([ids[next]!], "allSettled"), ctx),
      });
    }
    await root.commit(async (tx) => {
      for await (const name of names)
        ids[name] = await tx.createTask(Node, { name }, OWN_CONVERSATION);
    }, context);
    const outcomes = await Promise.all(names.map((name) => outcomeOf(harness, ids[name]!)));
    expect(outcomes.filter((outcome) => outcome === "faulted")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "completed")).toHaveLength(2);
    await harness.close(context);
  });

  it("resumes at the next pass when it waits on nothing", async () => {
    const { harness, root } = await openNodes();
    script("parent", { run: (runtime, ctx) => runtime.commit(() => waitOn([], "failFast"), ctx) });
    expect(await outcomeOf(harness, await start(root, "parent"))).toBe("completed");
    expect(log).toEqual(["run:parent", "resume:parent"]);
    await harness.close(context);
  });
});

describe("waiting", () => {
  it("keeps running phases after spawning and waits on subsets in sequence", async () => {
    const { harness, root } = await openNodes();
    const ids: TaskId[] = [];
    script("parent", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          for await (const name of ["a", "b", "c"]) ids.push(await spawn(tx, runtime.taskId, name));
          return { status: "running", checkpoint: { phase: "resume", round: 0 } };
        }, ctx);
      },
      resume: async (runtime, ctx, round) => {
        log.push(`round:${round}`);
        if (round === 0) return runtime.commit(() => waitOn([ids[0]!], "allSettled", 1), ctx);
        if (round === 1)
          return runtime.commit(() => waitOn([ids[1]!, ids[2]!], "failFast", 2), ctx);
        await runtime.commit(() => end("completed", "parent"), ctx);
      },
    });
    const parent = await start(root, "parent");
    await until(() => log.includes("round:0"));
    await until(async () => (await state(harness, parent)).status === "waiting");
    open("b");
    expect(await settled(harness.waitForTask(ids[1]!, context))).toBe(true);
    expect((await state(harness, parent)).status).toBe("waiting");
    open("a");
    await until(() => log.includes("round:1"));
    open("c");
    expect(await outcomeOf(harness, parent)).toBe("completed");
    expect(log.filter((line) => line.startsWith("round:"))).toEqual([
      "round:0",
      "round:1",
      "round:2",
    ]);
    await harness.close(context);
  });
});

describe("completing", () => {
  it("holds a finished task until its owned work drains; waiters and task documents wait for the final commit", async () => {
    const { harness, root } = await openNodes();
    let child: TaskId | undefined;
    script("parent", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          (await tx.doc(TaskNotes, runtime.taskId)).text = "notes";
          child = await spawn(tx, runtime.taskId, "child");
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx);
      },
    });
    const parent = await start(root, "parent");
    await until(async () => (await state(harness, parent)).status === "completing");
    expect(await state(harness, parent)).toEqual({
      status: "completing",
      outcome: { status: "completed", result: "parent" },
    });
    const waiter = harness.waitForTask(parent, context);
    expect(await settled(waiter)).toBe(false);
    expect(await harness.snapshot(TaskNotes, parent, context)).toEqual({ text: "notes" });
    expect(
      (await harness.inspect(context)).tasks.find((task) => task.record.id === parent)?.state,
    ).toEqual({
      kind: "completing",
    });
    expect(await settled(root.waitForIdle(context))).toBe(false);
    open("child");
    expect((await waiter).state.outcome).toEqual({ status: "completed", result: "parent" });
    expect(await harness.snapshot(TaskNotes, parent, context)).toBeUndefined();
    await root.waitForIdle(context);
    expect(child).toBeDefined();
    await harness.close(context);
  });
});

describe("completing", () => {
  it("keeps holding for ordinary work created during the hold", async () => {
    const { harness, root } = await openNodes();
    let conversation: ConversationId | undefined;
    script("parent", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          conversation = (
            await tx.createConversation({ ownership: { kind: "task", taskId: runtime.taskId } })
          ).id;
          await tx.createTask(
            Node,
            { name: "first" },
            { ...OWN_CONVERSATION, conversationId: conversation },
          );
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx);
      },
    });
    const parent = await start(root, "parent");
    await until(async () => (await state(harness, parent)).status === "completing");
    const child = (await harness.conversation(conversation!, context))!;
    await start(child, "second");
    open("first");
    await until(() => log.includes("run:second"));
    expect((await state(harness, parent)).status).toBe("completing");
    open("second");
    expect(await outcomeOf(harness, parent)).toBe("completed");
    await harness.close(context);
  });
});

describe("completing", () => {
  for (const [label, ending] of [
    ["a held failure", "failed"],
    ["a held scheduler fault", "throw"],
  ] as const) {
    it(`aborts the work below ${label}, then finishes with the held outcome`, async () => {
      const { harness, root } = await openNodes();
      let child: TaskId | undefined;
      script("parent", {
        run: async (runtime, ctx) => {
          await runtime.commit(async (tx) => {
            child = await spawn(tx, runtime.taskId, "child");
            return { status: "running", checkpoint: { phase: "resume", round: 1 } };
          }, ctx);
        },
        resume: async (runtime, ctx) => {
          if (ending === "throw") throw new Error("parent threw");
          await runtime.commit(() => end("failed", "parent"), ctx);
        },
      });
      const parent = await start(root, "parent");
      await until(() => child !== undefined);
      expect(await outcomeOf(harness, child!)).toBe("aborted");
      expect(await outcomeOf(harness, parent)).toBe(ending === "throw" ? "faulted" : "failed");
      await harness.close(context);
    });
  }
});

describe("completing", () => {
  it("only marks a completing task when aborted: the work below is aborted, the held outcome stays", async () => {
    const { harness, root } = await openNodes();
    let child: TaskId | undefined;
    script("parent", {
      run: async (runtime, ctx) => {
        await runtime.commit(async (tx) => {
          child = await spawn(tx, runtime.taskId, "child");
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx);
      },
    });
    const parent = await start(root, "parent");
    await until(async () => (await state(harness, parent)).status === "completing");
    expect(await harness.abortTask(parent, context)).toBe("marked");
    expect(await outcomeOf(harness, child!)).toBe("aborted");
    const settledParent = await harness.waitForTask(parent, context);
    expect(settledParent.state.outcome).toEqual({ status: "completed", result: "parent" });
    expect(settledParent.abortRequested).toBe(true);
    expect(log).not.toContain("abort:parent");
    expect(await harness.abortTask(parent, context)).toBe("terminal");
    await harness.close(context);
  });
});
