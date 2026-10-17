import { rm } from "node:fs/promises";

import { type JoinPolicy, type TaskId } from "@msa/durable";
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
  type NodeRuntime,
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
import { context } from "./session-support.ts";
import { deferred } from "./task-support.ts";

afterEach(async () => {
  behaviors.clear();
  gates.clear();
  log.length = 0;
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("waiting", () => {
  it("waits with allSettled on tasks it does not own, including already terminal ones", async () => {
    const { harness, root } = await openNodes();
    const done = await start(root, "done");
    open("done");
    await harness.waitForTask(done, context);
    const live = await start(root, "live");
    let outcomes: string[] = [];
    script("parent", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([done, live], "allSettled"), ctx),
      resume: async (runtime, ctx) => {
        outcomes = (await runtime.outcomes([done, live], ctx)).map((outcome) => outcome.status);
        await runtime.commit(() => end("completed", "parent"), ctx);
      },
    });
    const parent = await start(root, "parent");
    await until(async () => (await state(harness, parent)).status === "waiting");
    // A task it does not own is not its work: the parent may finish while it lives, but here it waits for it.
    open("live", "failed");
    expect(await outcomeOf(harness, parent)).toBe("completed");
    expect(outcomes).toEqual(["completed", "failed"]);
    await harness.close(context);
  });
});

describe("waiting", () => {
  it("rejects waits on itself, its owner, a missing task, and failFast on a task it does not own", async () => {
    const { harness, root } = await openNodes();
    const other = await start(root, "other");
    const cases: [string, (runtime: NodeRuntime) => readonly TaskId[], JoinPolicy, string][] = [
      ["self", (runtime) => [runtime.taskId], "allSettled", "is a wait cycle"],
      ["missing", () => [999_999 as TaskId], "allSettled", "does not exist"],
      ["foreign", () => [other], "failFast", "only on tasks it owns"],
    ];
    for await (const [name, on, policy, message] of cases) {
      script(name, {
        run: (runtime, ctx) => runtime.commit(() => waitOn(on(runtime), policy), ctx),
      });
      const id = await start(root, name);
      expect((await harness.waitForTask(id, context)).state.outcome).toMatchObject({
        status: "faulted",
        error: { message: expect.stringContaining(message) },
      });
    }
    // A child waiting on its owner could never resume.
    let child: TaskId | undefined;
    let parent: TaskId | undefined;
    script("child", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([parent!], "allSettled"), ctx),
    });
    script("parent", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          child = await spawn(tx, runtime.taskId, "child");
          return waitOn([child], "allSettled");
        }, ctx),
    });
    parent = await start(root, "parent");
    expect((await harness.waitForTask(parent, context)).state.outcome.status).toBe("completed");
    expect((await harness.waitForTask(child!, context)).state.outcome).toMatchObject({
      status: "faulted",
      error: { message: expect.stringContaining("is a wait cycle") },
    });
    open("other");
    await harness.close(context);
  });
});

describe("waiting", () => {
  // #10411; this test and the next two are from #10533 by @odysseus0.
  it("rejects the wait that closes a cycle", async () => {
    const { harness, root } = await openNodes();
    let a: TaskId | undefined;
    let b: TaskId | undefined;
    script("a", { run: (runtime, ctx) => runtime.commit(() => waitOn([b!], "allSettled"), ctx) });
    script("b", { run: (runtime, ctx) => runtime.commit(() => waitOn([a!], "allSettled"), ctx) });
    await root.commit(async (tx) => {
      a = await tx.createTask(Node, { name: "a" }, OWN_CONVERSATION);
      b = await tx.createTask(Node, { name: "b" }, OWN_CONVERSATION);
    }, context);
    // a -> b and b -> a are waits, and whichever comes second closes the cycle.
    const outcomes = await Promise.all([outcomeOf(harness, a!), outcomeOf(harness, b!)]);
    expect(outcomes.sort()).toEqual(["completed", "faulted"]);
    await harness.close(context);
  });

  // #10411
  it("rejects the wait that closes a cycle through a held owner", async () => {
    const { harness, root } = await openNodes();
    let held: TaskId | undefined;
    let other: TaskId | undefined;
    const child = spawnAndFinish("held", "child");
    script("child", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([other!], "allSettled"), ctx),
    });
    script("other", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([held!], "allSettled"), ctx),
    });
    await root.commit(async (tx) => {
      held = await tx.createTask(Node, { name: "held" }, OWN_CONVERSATION);
      other = await tx.createTask(Node, { name: "other" }, OWN_CONVERSATION);
    }, context);
    // held -> child is a hold; child -> other -> held are waits, and whichever wait comes second closes the cycle.
    expect(await outcomeOf(harness, held!)).toBe("completed");
    const outcomes = await Promise.all([outcomeOf(harness, child.id!), outcomeOf(harness, other!)]);
    expect(outcomes.sort()).toEqual(["completed", "faulted"]);
    await harness.close(context);
  });
});

describe("waiting", () => {
  // #10411
  it("rejects a cycle through holds two levels deep", async () => {
    const { harness, root } = await openNodes();
    let held: TaskId | undefined;
    let other: TaskId | undefined;
    const child = spawnAndFinish("held", "child");
    const grandchild = spawnAndFinish("child", "grandchild");
    script("grandchild", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([other!], "allSettled"), ctx),
    });
    script("other", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([held!], "allSettled"), ctx),
    });
    await root.commit(async (tx) => {
      held = await tx.createTask(Node, { name: "held" }, OWN_CONVERSATION);
      other = await tx.createTask(Node, { name: "other" }, OWN_CONVERSATION);
    }, context);
    // held -> child -> grandchild are holds; grandchild -> other -> held are waits.
    await until(() => grandchild.id !== undefined);
    const outcomes = await Promise.all([
      outcomeOf(harness, grandchild.id!),
      outcomeOf(harness, other!),
    ]);
    expect(outcomes.sort()).toEqual(["completed", "faulted"]);
    expect(await outcomeOf(harness, child.id!)).toBe("completed");
    await harness.close(context);
  });
});

describe("waiting", () => {
  // #10411
  it("lets a background task wait on the owner of its conversation", async () => {
    const { harness, root } = await openNodes();
    let owner: TaskId | undefined;
    script("background", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([owner!], "allSettled"), ctx),
    });
    const background = await root.commit(async (tx) => {
      owner = await tx.createTask(Node, { name: "owner" }, OWN_CONVERSATION);
      const conversation = await tx.createConversation({
        ownership: { kind: "task", taskId: owner },
      });
      const options = { ...OWN_CONVERSATION, conversationId: conversation.id, background: true };
      return tx.createTask(Node, { name: "background" }, options);
    }, context);
    // background -> owner is a wait but owner -> background is no hold, so there is no cycle.
    await until(async () => (await state(harness, background)).status === "waiting");
    open("owner");
    expect(await outcomeOf(harness, background)).toBe("completed");
    await harness.close(context);
  });
});

describe("waiting", () => {
  // #10411: the issue's orchestrator, worker, and reviewer.
  it("rejects a cycle of a hold and two waits that each look reasonable", async () => {
    const { harness, root } = await openNodes();
    const ids: Record<string, TaskId> = {};
    const reviewerWaits = deferred();
    // The orchestrator spawns a worker and finishes; the running worker holds it as completing.
    script("orchestrator", {
      run: (runtime, ctx) =>
        runtime.commit(async (tx) => {
          ids["worker"] = await spawn(tx, runtime.taskId, "worker");
          return { status: "running", checkpoint: { phase: "resume", round: 1 } };
        }, ctx),
    });
    // The reviewer waits for the orchestrator's result.
    script("reviewer", {
      run: async (runtime, ctx) => {
        await runtime.commit(() => waitOn([ids["orchestrator"]!], "allSettled"), ctx);
        reviewerWaits.resolve();
      },
    });
    // The worker waits for the reviewer, closing the cycle.
    script("worker", {
      run: async (runtime, ctx) => {
        await reviewerWaits.promise;
        await runtime.commit(() => waitOn([ids["reviewer"]!], "allSettled"), ctx);
      },
    });
    ids["orchestrator"] = await start(root, "orchestrator");
    await until(async () => (await state(harness, ids["orchestrator"]!)).status === "completing");
    ids["reviewer"] = await start(root, "reviewer");
    const outcomes = await Promise.all(
      ["orchestrator", "worker", "reviewer"].map((name) => outcomeOf(harness, ids[name]!)),
    );
    expect(outcomes).toEqual(["completed", "faulted", "completed"]);
    const worker = (await harness.waitForTask(ids["worker"]!, context)).state.outcome;
    expect(JSON.stringify(worker)).toContain(
      `${ids["worker"]} -> ${ids["reviewer"]} -> ${ids["orchestrator"]} -> ${ids["worker"]} is a wait cycle`,
    );
    await harness.close(context);
  });
});

describe("waiting", () => {
  // #10411
  it("allows a diamond of waits", async () => {
    const { harness, root } = await openNodes();
    const ids: Record<string, TaskId> = {};
    // A diamond: top waits on left and right, both wait on bottom. No cycle.
    script("top", {
      run: (runtime, ctx) =>
        runtime.commit(() => waitOn([ids["left"]!, ids["right"]!], "allSettled"), ctx),
    });
    script("left", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([ids["bottom"]!], "allSettled"), ctx),
    });
    script("right", {
      run: (runtime, ctx) => runtime.commit(() => waitOn([ids["bottom"]!], "allSettled"), ctx),
    });
    await root.commit(async (tx) => {
      ids["bottom"] = await tx.createTask(Node, { name: "bottom" }, OWN_CONVERSATION);
      ids["left"] = await tx.createTask(Node, { name: "left" }, OWN_CONVERSATION);
      ids["right"] = await tx.createTask(Node, { name: "right" }, OWN_CONVERSATION);
      ids["top"] = await tx.createTask(Node, { name: "top" }, OWN_CONVERSATION);
    }, context);
    open("bottom");
    const topId = ids["top"];
    if (topId === undefined) throw new Error("Expected the top task id");
    expect(await outcomeOf(harness, topId)).toBe("completed");
    await harness.close(context);
  });
});
