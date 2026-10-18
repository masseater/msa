import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context, JsonValue } from "@msa/chord";
import { defineTask, type Task, type TaskId, type TaskRuntime } from "@msa/durable";
import { createRegistry } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";

import { addTask } from "./harness-support.ts";
import { context, flush } from "./session-support.ts";
import { abortedWith, completed, eventually, openTasks } from "./task-support.ts";

export const directories = new Set<string>();

export async function sqlitePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msa-durable-tasks-"));
  directories.add(directory);
  return join(directory, "session.sqlite");
}

export type OpenHarness = Awaited<ReturnType<typeof openTasks>>["harness"];

export async function createIn<S extends { phase: string }, R>(
  harness: OpenHarness,
  task: Task<null, S, R, object>,
): Promise<TaskId<R>> {
  const root = await harness.root(context);
  return root.commit(
    (tx) => tx.createTask(task, null, { ownership: { kind: "conversation" } }),
    context,
  );
}

export type Step = { phase: "run" };

// A versioned one-phase task that completes with `result`, optionally migrating older records.
export function versioned(
  version: number,
  result: string,
  migrate?: (
    input: JsonValue,
    checkpoint: JsonValue,
    fromVersion: number,
  ) => { input: null; checkpoint: Step },
) {
  return defineTask<null, Step, JsonValue>({
    name: "test.versioned",
    version,
    initial: () => ({ phase: "run" }),
    phases: { run: (_task, runtime, ctx) => runtime.commit(() => completed(result), ctx) },
    abort: (_task, runtime, ctx) => runtime.commit(() => abortedWith(result), ctx),
    ...(migrate === undefined ? {} : { migrate }),
  });
}

export type Handover = { phase: "a" } | { phase: "b" } | { phase: "c" };

export type Gates = {
  readonly a?: Promise<void>;
  readonly b?: Promise<void>;
  readonly onEnd?: () => void;
};

export function handoverTask(
  label: string,
  version: number,
  log: string[],
  options: {
    readonly gates?: Gates;
    readonly migrate?: () => { input: null; checkpoint: Handover };
  } = {},
) {
  const advance =
    (phase: "a" | "b", next: Handover) =>
    async (_task: unknown, runtime: TaskRuntime<null, Handover, null, object>, ctx: Context) => {
      log.push(`${label}:${phase} start`);
      await options.gates?.[phase];
      await runtime.commit(() => ({ status: "running", checkpoint: next }), ctx);
      // Leave room for a wrongly dispatched successor before this invocation ends.
      await flush();
      options.gates?.onEnd?.();
      log.push(`${label}:${phase} end`);
    };
  return defineTask<null, Handover, null>({
    name: "test.handover",
    version,
    initial: () => ({ phase: "a" }),
    phases: {
      a: advance("a", { phase: "b" }),
      b: advance("b", { phase: "c" }),
      c: async (_task, runtime, ctx) => {
        log.push(`${label}:c`);
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async (_task, runtime, ctx) => {
      log.push(`${label}:abort`);
      await runtime.commit(() => abortedWith(label), ctx);
    },
    ...(options.migrate === undefined ? {} : { migrate: options.migrate }),
  });
}

export async function startHandover(log: string[], gates: Gates, storage = new MemoryStorage()) {
  const registry = createRegistry();
  const old = addTask(registry, handoverTask("old", 1, log, { gates }));
  const opened = await openTasks(storage, [], { registry });
  const id = await createIn(opened.harness, handoverTask("old", 1, log));
  opened.harness.resume();
  await eventually(() => log.length === 1);
  return { ...opened, old, id };
}
