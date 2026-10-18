import { defineTask, type TaskId, type TaskInspection } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat, unanswered, waitFor } from "./chat-support.ts";
import { context } from "./session-support.ts";
import { completed, type Deferred, deferred, eventually, openTasks } from "./task-support.ts";

type Step = { phase: "run" };

// A one-phase task that completes once `gate` resolves; `migrate` runs when an older stored version migrates.
function task(
  name: string,
  version: number,
  options: { gate?: Promise<void>; migrate?: () => void } = {},
) {
  const migrate = options.migrate;
  return defineTask<null, Step, null>({
    name,
    version,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (_task, runtime, ctx) => {
        await options.gate;
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async () => {},
    ...(migrate === undefined
      ? {}
      : {
          migrate: () => {
            migrate();
            return { input: null, checkpoint: { phase: "run" as const } };
          },
        }),
  });
}

function stateOf(
  tasks: readonly TaskInspection[],
  id: TaskId,
): TaskInspection["state"] | undefined {
  return tasks.find((entry) => entry.record.id === id)?.state;
}

type Gated = { gateId?: TaskId };

// Waits on the task in `gated.gateId`, then completes.
function dependentOn(gated: Gated) {
  return defineTask<null, { phase: "wait" } | { phase: "done" }, null>({
    name: "test.dependent",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (_task, runtime, ctx) => {
        const checkpoint = { phase: "done" } as const;
        await runtime.commit(
          () => ({ status: "waiting", checkpoint, on: [gated.gateId!], policy: "allSettled" }),
          ctx,
        );
      },
      done: (_task, runtime, ctx) => Promise.resolve(runtime.commit(() => completed(null), ctx)),
    },
    abort: async () => {},
  });
}

function registeredTasks(
  Gate: ReturnType<typeof task>,
  Dependent: ReturnType<typeof dependentOn>,
  counts: { migrations: number },
) {
  return [
    Gate,
    Dependent,
    task("test.migrating", 2, {
      migrate: () => {
        counts.migrations++;
      },
    }),
    task("test.no-migration", 2),
    task("test.failing", 2, {
      migrate: () => {
        throw new Error("cannot migrate");
      },
    }),
    task("test.too-old", 1),
  ];
}

// A gate, a task waiting on it, and tasks stored by definitions other than the registered ones.
async function openInspected(gate: Deferred<void>) {
  const Gate = task("test.gate", 1, { gate: gate.promise });
  const gated: Gated = {};
  const Dependent = dependentOn(gated);
  const counts = { migrations: 0 };
  const { harness } = await openTasks(
    new MemoryStorage(),
    registeredTasks(Gate, Dependent, counts),
  );
  const root = await harness.root(context);
  const ids = await root.commit(async (tx) => {
    const gateId = await tx.createTask(Gate, null, { ownership: { kind: "conversation" } });
    gated.gateId = gateId;
    return {
      gate: gateId,
      dependent: await tx.createTask(Dependent, null, { ownership: { kind: "conversation" } }),
      // Stored by definitions other than the registered ones.
      migrating: await tx.createTask(task("test.migrating", 1), null, {
        ownership: { kind: "conversation" },
      }),
      noMigration: await tx.createTask(task("test.no-migration", 1), null, {
        ownership: { kind: "conversation" },
      }),
      failing: await tx.createTask(task("test.failing", 1), null, {
        ownership: { kind: "conversation" },
      }),
      tooOld: await tx.createTask(task("test.too-old", 2), null, {
        ownership: { kind: "conversation" },
      }),
      missing: await tx.createTask(task("test.missing", 1), null, {
        ownership: { kind: "conversation" },
      }),
    };
  }, context);
  return { harness, ids, counts };
}

function expectPausedStates(
  paused: Awaited<ReturnType<Awaited<ReturnType<typeof openInspected>>["harness"]["inspect"]>>,
  ids: Awaited<ReturnType<typeof openInspected>>["ids"],
) {
  expect(paused.scheduling).toBe("paused");
  expect(paused.tasks.map((entry) => entry.record.id)).toEqual(Object.values(ids));
  expect(stateOf(paused.tasks, ids.gate)).toEqual({ kind: "ready", migrates: false });
  expect(stateOf(paused.tasks, ids.dependent)).toEqual({ kind: "ready", migrates: false });
  expect(stateOf(paused.tasks, ids.migrating)).toEqual({ kind: "ready", migrates: true });
  // A migration that was never tried is not run to find out.
  expect(stateOf(paused.tasks, ids.failing)).toEqual({ kind: "ready", migrates: true });
  expect(stateOf(paused.tasks, ids.noMigration)).toMatchObject({
    kind: "blocked",
    reason: "migration_failed",
    error: new Error("Task test.no-migration version 2 has no migration from 1"),
  });
  expect(stateOf(paused.tasks, ids.tooOld)).toEqual({ kind: "blocked", reason: "task_too_old" });
  expect(stateOf(paused.tasks, ids.missing)).toEqual({ kind: "blocked", reason: "missing_task" });
}

describe("Harness.inspect()", () => {
  it("derives every live task's state without running task code", async () => {
    const gate = deferred();
    const { harness, ids, counts } = await openInspected(gate);

    expectPausedStates(await harness.inspect(context), ids);
    expect(counts.migrations).toBe(0);
    expect((await harness.inspect(context)).scheduling).toBe("paused");

    harness.resume();
    await eventually(() => counts.migrations === 1);
    await harness.waitForTask(ids.migrating, context);
    let running = await harness.inspect(context);
    await waitFor(async () => {
      running = await harness.inspect(context);
      return (
        stateOf(running.tasks, ids.gate)?.kind === "running" &&
        stateOf(running.tasks, ids.dependent)?.kind === "waiting"
      );
    });
    expect(stateOf(running.tasks, ids.dependent)).toEqual({ kind: "waiting", on: [ids.gate] });
    expect(running.scheduling).toBe("running");
    expect(stateOf(running.tasks, ids.gate)).toEqual({ kind: "running" });
    expect(stateOf(running.tasks, ids.migrating)).toBeUndefined();
    expect(stateOf(running.tasks, ids.failing)).toEqual({
      kind: "blocked",
      reason: "migration_failed",
      error: new Error("cannot migrate"),
    });

    gate.resolve();
    await harness.waitForTask(ids.dependent, context);
    const settled = await harness.inspect(context);
    expect(settled.tasks.map((entry) => entry.record.id)).toEqual([
      ids.noMigration,
      ids.failing,
      ids.tooOld,
      ids.missing,
    ]);
    await harness.close(context);
  });
});

describe("Harness.inspect()", () => {
  it("lists unsettled submissions", async () => {
    const setup = chatSetup();
    const busy = unanswered();
    setup.faux.setResponses([busy.step]);
    const { harness, root } = await openChat(new MemoryStorage(), setup);
    const other = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    await other.submit({ type: "write", entry: { kind: "note" } }, context);
    const input = await root.submit({ type: "input", content: "hi" }, context);
    await busy.reached;

    const inspection = await harness.inspect(context);
    expect(inspection.submissions).toEqual([await input.status(context)]);
    expect(inspection.tasks.map((entry) => [entry.record.kind, entry.state.kind])).toEqual([
      ["msa.generation", "running"],
    ]);
    await harness.close(context);
  });
});
