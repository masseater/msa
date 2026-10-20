import { type Harness, type TaskId, type TaskRuntime, defineTask } from "@msa/durable";
import { Effect } from "effect";

import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { joinPath, makeTempDir } = platformSupport;
const { context } = sessionSupport;
const { aborted, deferred } = taskSupport;

const gates = new Map<string, PromiseWithResolvers<void>>();

function gate(name: string): PromiseWithResolvers<void> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<void>();
    gates.set(name, found);
  }
  return found;
}

const Hold = defineTask<{ name: string }, { phase: "hold" }, null>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "hold" }),
  name: "test.index.hold",
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
              () => ({ outcome: { result: null, status: "completed" }, status: "terminal" }),
              ctx,
            ),
          );
        }),
      ),
  },
  version: 1,
});

const owned = new Map<string, TaskId[]>();

const runtimes = new Map<
  string,
  Pick<TaskRuntime<unknown, unknown, unknown, object>, "ownedTasks">
>();

const directories: string[] = [];

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-indexes-");
  directories.push(directory);
  return joinPath(directory, "session.sqlite");
});

const state = Effect.fn("state")(function* (harness: Harness, id: TaskId) {
  return (yield* awaited(harness.getTask(id, context)))!;
});

const harnessSchedulerIndexesSupport = {
  Hold,
  directories,
  gate,
  gates,
  owned,
  runtimes,
  sqlitePath,
  state,
};

export default harnessSchedulerIndexesSupport;
