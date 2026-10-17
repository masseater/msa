import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineTask, type Harness, type TaskId, type TaskRuntime } from "@msa/durable";

import { context } from "./session-support.ts";
import { aborted, type Deferred, deferred } from "./task-support.ts";

export const gates = new Map<string, Deferred<void>>();

export function gate(name: string): Deferred<void> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<void>();
    gates.set(name, found);
  }
  return found;
}

/** Holds until its gate opens, then completes; its abort handler ends it `aborted`. */
export const Hold = defineTask<{ name: string }, { phase: "hold" }, null>({
  name: "test.index.hold",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    hold: async (task, runtime, ctx) => {
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

/** What `ownedTasks()` returned to each run of a `Probe`, by its name, and the runtime of its last run. */
export const owned = new Map<string, TaskId[]>();

export const runtimes = new Map<
  string,
  Pick<TaskRuntime<unknown, unknown, unknown, object>, "ownedTasks">
>();

export const directories: string[] = [];

export async function sqlitePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msa-durable-indexes-"));
  directories.push(directory);
  return join(directory, "session.sqlite");
}

export async function state(harness: Harness, id: TaskId) {
  return (await harness.getTask(id, context))!;
}
