import { rm } from "node:fs/promises";

import { createModels } from "@msa/ai";
import { defineTask, type TaskId, type TaskRuntime } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { addTask } from "./harness-support.ts";
import {
  startHandover,
  createIn,
  type OpenHarness,
  handoverTask,
  type Handover,
  type Gates,
  directories,
  type Step,
} from "./harness-tasks-recovery-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { completed, countingReader, deferred, eventually, openTasks } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("definition handover", () => {
  it("keeps running under the old definition when the replacement is missing or cannot take the task", async () => {
    const log: string[] = [];
    const gateA = deferred();
    const gateB = deferred();
    const { harness, registry, old, id, reports } = await startHandover(log, {
      a: gateA.promise,
      b: gateB.promise,
    });
    old.dispose();
    gateA.resolve();
    await eventually(() => log.includes("old:b start"));
    // A newer definition without a migration cannot take the task either.
    addTask(registry, handoverTask("incompatible", 2, log));
    gateB.resolve();
    await harness.waitForTask(id, context);
    expect(log).toEqual(["old:a start", "old:a end", "old:b start", "old:b end", "old:c"]);
    expect(reports.map((report) => (report as Error).cause)).toEqual([
      "missing_task",
      "incompatible_task",
    ]);
    await harness.close(context);
  });
});

describe("definition handover", () => {
  it("rejects a runtime commit of the old invocation queued behind its handover commit", async () => {
    const log: string[] = [];
    const gate = deferred();
    const storage = new ControlledStorage();
    let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
    let oldRuntime: TaskRuntime<null, Handover, null, object> | undefined;
    let harnessRef: OpenHarness | undefined;
    const registry = createRegistry();
    const Old = defineTask<null, Handover, null>({
      name: "test.handover",
      version: 1,
      initial: () => ({ phase: "a" }),
      phases: {
        a: async (task, runtime, ctx) => {
          oldRuntime = runtime;
          await gate.promise;
          await runtime.commit(() => ({ status: "running", checkpoint: { phase: "b" } }), ctx);
          // Hold the line with an unrelated commit so the handover commit queues behind it.
          held = storage.holdCommits();
          void harnessRef!.commit(async (tx) => {
            await tx.appendEntry(task.conversationId, { kind: "blocker" });
          }, ctx);
        },
        b: async () => {},
        c: async () => {},
      },
      abort: async () => {},
    });
    addTask(registry, Old);
    const { harness } = await openTasks(storage, [], { registry });
    harnessRef = harness;
    const id = await createIn(harness, Old);
    harness.resume();
    await eventually(() => oldRuntime !== undefined);
    // The same extension name replaces the old one in place.
    addTask(registry, handoverTask("new", 1, log));
    gate.resolve();
    await eventually(() => held !== undefined);
    await held!.entered;
    await flush();
    // Queued behind the handover commit while the invocation has not ended yet.
    const late = oldRuntime!.commit(() => completed(null), context);
    held!.release();
    await expect(late).rejects.toThrow("invocation has ended");
    await harness.waitForTask(id, context);
    expect(log).toEqual(["new:b start", "new:b end", "new:c"]);
    await harness.close(context);
  });
});

describe("definition handover", () => {
  it("preserves an abort mark that races the handover commit; the new definition aborts", async () => {
    const log: string[] = [];
    const gate = deferred();
    const storage = new ControlledStorage();
    let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
    // The progress commit landed; hold the next commit, the handover, and queue the abort mark behind it.
    const gates: Gates = {
      a: gate.promise,
      onEnd: () => {
        held ??= storage.holdCommits();
      },
    };
    const { harness, registry, id } = await startHandover(log, gates, storage);
    // The same extension name replaces the old one in place.
    addTask(registry, handoverTask("new", 1, log));
    gate.resolve();
    await eventually(() => held !== undefined);
    await held!.entered;
    const aborting = harness.abortTask(id, context);
    held!.release();
    expect(await aborting).toBe("marked");
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "new",
    });
    const states = storage.commits.flatMap((writes) =>
      writes.flatMap((write) =>
        write.type === "task" && write.value.id === id
          ? [`${write.value.state.status}${write.value.abortRequested ? "+mark" : ""}`]
          : [],
      ),
    );
    // created, reserved, progress, handover, mark, abort reservation, aborted
    expect(states).toEqual([
      "pending",
      "running",
      "running",
      "pending",
      "pending+mark",
      "running+mark",
      "terminal+mark",
    ]);
    expect(log).toEqual(["old:a start", "old:a end", "new:abort"]);
    await harness.close(context);
  });
});

describe("Harness open", () => {
  it("releases its registry subscription and closes the Session when open fails", async () => {
    const storage = new ControlledStorage();
    const log: string[] = [];
    const Stuck = defineTask<null, Step, null>({
      name: "test.stuck",
      version: 1,
      initial: () => ({ phase: "run" }),
      phases: {
        run: async () => {
          log.push("run");
          await new Promise(() => {});
        },
      },
      abort: async () => {},
    });
    // Leave a running task behind so open has a reconciliation commit to fail.
    const first = await openTasks(storage, [Stuck]);
    await createIn(first.harness, Stuck);
    first.harness.resume();
    await eventually(() => log.length === 1);

    const registry = createRegistry();
    const reader = countingReader(registry);
    storage.failNextCommit(new Error("disk full"));
    await expect(
      Harness.open(storage, { models: createModels(), registry: reader }, context),
    ).rejects.toThrow("disk full");
    expect(reader.subscriptions()).toBe(0);
    await expect(storage.task(1 as TaskId, context)).rejects.toThrow();
  });
});
