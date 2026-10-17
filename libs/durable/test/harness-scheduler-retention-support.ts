import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Conversation,
  defineTask,
  type Harness,
  type Storage,
  type TaskId,
} from "@msa/durable";

import { SCHEDULER_INDEX_SIZES } from "../src/harness/harness.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred, openTasks } from "./task-support.ts";

export const gates = new Map<string, Deferred<void>>();

export function gate(name: string): Deferred<void> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<void>();
    gates.set(name, found);
  }
  return found;
}

/** How often each named task started its phase. */
export const runs = new Map<string, number>();

/** Holds until its gate opens, then completes; its abort handler ends it `aborted`. */
export const Hold = defineTask<{ name: string }, { phase: "hold" }, null>({
  name: "test.retention.hold",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    hold: async (task, runtime, ctx) => {
      runs.set(task.input.name, (runs.get(task.input.name) ?? 0) + 1);
      const opened = await Promise.race([
        gate(task.input.name).promise.then(() => true),
        aborted(runtime.signal),
      ]);
      if (opened !== true) return;
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        ctx,
      );
    },
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

/** Holds until its gate opens, then creates a held task `inside.<name>` in conversation `input.into` and ends. */
export const Spawner = defineTask<{ name: string; into: number }, { phase: "hold" }, null>({
  name: "test.retention.spawner",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    hold: async (task, runtime, ctx) => {
      const opened = await Promise.race([
        gate(task.input.name).promise.then(() => true),
        aborted(runtime.signal),
      ]);
      if (opened !== true) return;
      await runtime.commit(async (tx) => {
        await tx.createTask(
          Hold,
          { name: `inside.${task.input.name}` },
          { ownership: { kind: "conversation" }, conversationId: task.input.into as never },
        );
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, ctx);
    },
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

/** Rejected commits it caught. */
export const rejections: unknown[] = [];

/**
 * Holds until `rejected` opens, then tries one terminal commit that creates a task in conversation `into` and a child of
 * its own, which the Transaction rejects as the task is ending. Catches the rejection and holds.
 */
export const Rejected = defineTask<{ into: number }, { phase: "hold" }, null>({
  name: "test.retention.rejected",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    hold: async (task, runtime, ctx) => {
      const opened = await Promise.race([
        gate("rejected").promise.then(() => true),
        aborted(runtime.signal),
      ]);
      if (opened !== true) return;
      try {
        await runtime.commit(async (tx) => {
          await tx.createTask(
            Hold,
            { name: "staged" },
            { ownership: { kind: "conversation" }, conversationId: task.input.into as never },
          );
          await tx.createTask(
            Hold,
            { name: "child" },
            { ownership: { kind: "task", taskId: task.id } },
          );
          return { status: "terminal", outcome: { status: "completed", result: null } };
        }, ctx);
      } catch (error) {
        rejections.push(error);
      }
      await aborted(runtime.signal);
    },
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

export type Sizes = Record<
  "live" | "settled" | "edges" | "below" | "roots" | "unloaded" | "dropQueue",
  number
>;

export function sizes(harness: Harness): Sizes {
  return (harness as unknown as Record<symbol, Sizes>)[SCHEDULER_INDEX_SIZES]!;
}

export const directories: string[] = [];

export async function sqlitePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msa-durable-retention-"));
  directories.push(directory);
  return join(directory, "session.sqlite");
}

export async function open(storage?: Storage) {
  const opened = await openTasks(storage ?? (await openNodeSqliteStorage(await sqlitePath())), [
    Hold,
    Spawner,
    Rejected,
  ]);
  const root = await opened.harness.root(context);
  opened.harness.resume();
  return { ...opened, root };
}

export async function status(harness: Harness, id: TaskId) {
  return (await harness.getTask(id, context))!.state;
}

// Under live `parent`: tool task T owning conversation C, a task in C; all of them end. Returns C.
export async function subagentCycle(
  harness: Harness,
  root: Conversation,
  parent: TaskId,
  n: number,
) {
  const { tool, inner, child } = await root.commit(async (tx) => {
    const tool = await tx.createTask(
      Hold,
      { name: `tool${n}` },
      { ownership: { kind: "task", taskId: parent } },
    );
    const child = await tx.createConversation({ ownership: { kind: "task", taskId: tool } });
    const inner = await tx.createTask(
      Hold,
      { name: `inner${n}` },
      { ownership: { kind: "conversation" }, conversationId: child.id },
    );
    return { tool, inner, child: child.id };
  }, context);
  gate(`inner${n}`).resolve();
  gate(`tool${n}`).resolve();
  await harness.waitForTask(inner, context);
  await harness.waitForTask(tool, context);
  return child;
}
