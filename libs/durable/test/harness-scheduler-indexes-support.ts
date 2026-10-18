import { defineTask, type Harness, type TaskId, type TaskRuntime } from "@msa/durable";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { joinPath, makeTempDir } from "./platform-support.ts";
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

export const Hold = defineTask<{ name: string }, { phase: "hold" }, null>({
  name: "test.index.hold",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    hold: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const opened = yield* awaited(
            Promise.race([gate(task.input.name).promise.then(() => true), aborted(runtime.signal)]),
          );
          if (opened !== true) return;
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
              ctx,
            ),
          );
        }),
      ),
  },
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
    ),
});

export const owned = new Map<string, TaskId[]>();

export const runtimes = new Map<
  string,
  Pick<TaskRuntime<unknown, unknown, unknown, object>, "ownedTasks">
>();

export const directories: string[] = [];

export const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-indexes-");
  directories.push(directory);
  return joinPath(directory, "session.sqlite");
});

export const state = Effect.fn("state")(function* (harness: Harness, id: TaskId) {
  return (yield* awaited(harness.getTask(id, context)))!;
});
