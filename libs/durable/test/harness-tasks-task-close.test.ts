import { createModels } from "@msa/ai";
import { defineTask, type RegistryReader } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { addTask } from "./harness-support.ts";
import { start, oneStep, openRoot } from "./harness-tasks-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { completed, deferred, eventually } from "./task-support.ts";

function sealingTask() {
  const phases: string[] = [];
  const registry = createRegistry();
  const state: {
    harnessRef?: Awaited<ReturnType<typeof openRoot>>["harness"];
    closing?: Promise<void>;
    closeOnSnapshot: boolean;
  } = { closeOnSnapshot: false };
  // The step refreshes the snapshot after progress, inside its line callback and after its closing check.
  const reader: RegistryReader = {
    snapshot: () => {
      if (state.closeOnSnapshot) {
        state.closeOnSnapshot = false;
        state.closing = state.harnessRef!.close(context);
      }
      return registry.snapshot();
    },
    subscribe: (listener) => registry.subscribe(listener),
  };
  const Two = defineTask<null, { phase: "one" } | { phase: "two" }, null>({
    name: "test.close-in-step",
    version: 1,
    initial: () => ({ phase: "one" }),
    phases: {
      one: async (_task, runtime, ctx) => {
        phases.push("one");
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "two" } }), ctx);
        state.closeOnSnapshot = true;
      },
      two: () => {
        phases.push("two");

        return Promise.resolve();
      },
    },
    abort: async () => {},
  });
  addTask(registry, Two);
  return { phases, state, reader, Two };
}

describe("task close", () => {
  it("starts no abort handler whose reservation settles while closing", async () => {
    let ran = false;
    const Marked = oneStep(
      "test.close-abort-reservation",
      async () => {},
      () => {
        ran = true;

        return Promise.resolve();
      },
    );
    const storage = new ControlledStorage();
    const { harness, root } = await openRoot([Marked], { storage });
    const id = await start(root, Marked);
    expect(await harness.abortTask(id, context)).toBe("marked");
    const held = storage.holdCommits();
    harness.resume();
    await held.entered;
    const closing = harness.close(context);
    held.release();
    await closing;
    expect(ran).toBe(false);
    const writes = storage.commits.at(-1)!.filter((write) => write.type === "task");
    expect(writes).toMatchObject([
      { value: { id, abortRequested: true, state: { status: "running" } } },
    ]);
  });
});

describe("task close", () => {
  it("rejects a runtime commit that was queued on the line when close sealed it", async () => {
    const storage = new ControlledStorage();
    let queued: Promise<unknown> | undefined;
    let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
    let harnessRef: Awaited<ReturnType<typeof openRoot>>["harness"] | undefined;
    const proceed = deferred();
    const Queued = oneStep("test.close-queued-commit", async (_task, runtime) => {
      held = storage.holdCommits();
      void harnessRef!.commit(async (tx) => {
        await tx.appendEntry(runtime.conversationId, { kind: "blocker" });
      }, context);
      queued = runtime.commit(() => completed(null), context).catch((error: unknown) => error);
      // Ignores the close signal, so the invocation is still alive when the queued commit reaches the line.
      await proceed.promise;
    });
    const { harness, root } = await openRoot([Queued], { storage });
    harnessRef = harness;
    const id = await start(root, Queued);
    harness.resume();
    await eventually(() => held !== undefined);
    await held!.entered;
    await flush();
    const closing = harness.close(context);
    held!.release();
    expect(String(await queued)).toContain("Harness is closed");
    proceed.resolve();
    await closing;
    const taskWrites = storage.commits.flatMap((writes) =>
      writes.filter((write) => write.type === "task" && write.value.id === id),
    );
    expect(taskWrites).toHaveLength(2);
  });
});

describe("task close", () => {
  it("starts no next phase when close seals during a step that decided to continue", async () => {
    const { phases, state, reader, Two } = sealingTask();
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: createModels(), registry: reader },
      context,
    );
    state.harnessRef = harness;
    const root = await harness.root(context);
    await root.commit(
      (tx) => tx.createTask(Two, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    await eventually(() => state.closing !== undefined);
    await state.closing;
    expect(phases).toEqual(["one"]);
  });

  it("joins a reservation that settles while closing without starting its handler", async () => {
    let ran = false;
    const Never = oneStep("test.close-reservation", () => {
      ran = true;

      return Promise.resolve();
    });
    const storage = new ControlledStorage();
    const { harness, root } = await openRoot([Never], { storage });
    const id = await start(root, Never);
    const held = storage.holdCommits();
    harness.resume();
    await held.entered;
    const closing = harness.close(context);
    held.release();
    await closing;
    expect(ran).toBe(false);
    const writes = storage.commits.at(-1)!.filter((write) => write.type === "task");
    expect(writes).toMatchObject([{ type: "task", value: { id, state: { status: "running" } } }]);
  });
});
