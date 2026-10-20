import {
  type Conversation,
  type Harness,
  type Storage,
  type TaskId,
  defineTask,
} from "@msa/durable";
import { Effect } from "effect";

import { SCHEDULER_INDEX_SIZES } from "../src/harness/harness.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import type harnessSchedulerRetentionSupportTypes from "./harness-scheduler-retention-support.types.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { joinPath, makeTempDir } = platformSupport;
const { context } = sessionSupport;
const { aborted, deferred, openTasks } = taskSupport;

const gates = new Map<string, PromiseWithResolvers<void>>();

function gate(name: string): PromiseWithResolvers<void> {
  let found = gates.get(name);
  if (found === undefined) {
    found = deferred<void>();
    gates.set(name, found);
  }
  return found;
}

const runs = new Map<string, number>();

const Hold = defineTask<{ name: string }, { phase: "hold" }, null>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "hold" }),
  name: "test.retention.hold",
  phases: {
    hold: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          runs.set(task.input.name, (runs.get(task.input.name) ?? 0) + 1);
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

const Spawner = defineTask<{ name: string; into: number }, { phase: "hold" }, null>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "hold" }),
  name: "test.retention.spawner",
  phases: {
    hold: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const opened = yield* awaited(
            Promise.race([gate(task.input.name).promise.then(() => true), aborted(runtime.signal)]),
          );
          if (opened !== true) return;
          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    yield* awaited(
                      tx.createTask(
                        Hold,
                        { name: `inside.${task.input.name}` },
                        {
                          conversationId: task.input.into as never,
                          ownership: { kind: "conversation" },
                        },
                      ),
                    );
                    return { outcome: { result: null, status: "completed" }, status: "terminal" };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  },
  version: 1,
});

const rejections: unknown[] = [];

const Rejected = defineTask<{ into: number }, { phase: "hold" }, null>({
  abort: (_task, runtime, ctx) =>
    Promise.resolve(
      runtime.commit(() => ({ outcome: { status: "aborted" }, status: "terminal" }), ctx),
    ),
  initial: () => ({ phase: "hold" }),
  name: "test.retention.rejected",
  phases: {
    hold: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const opened = yield* awaited(
            Promise.race([gate("rejected").promise.then(() => true), aborted(runtime.signal)]),
          );
          if (opened !== true) return;
          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    yield* awaited(
                      tx.createTask(
                        Hold,
                        { name: "staged" },
                        {
                          conversationId: task.input.into as never,
                          ownership: { kind: "conversation" },
                        },
                      ),
                    );
                    yield* awaited(
                      tx.createTask(
                        Hold,
                        { name: "child" },
                        { ownership: { kind: "task", taskId: task.id } },
                      ),
                    );
                    return { outcome: { result: null, status: "completed" }, status: "terminal" };
                  }),
                ),
              ctx,
            ),
          ).pipe(
            Effect.catchDefect((error) =>
              Effect.sync(() => {
                rejections.push(error);
              }),
            ),
          );
          return yield* awaited(aborted(runtime.signal));
        }),
      ),
  },
  version: 1,
});

function sizes(harness: Harness): harnessSchedulerRetentionSupportTypes.Sizes {
  return (harness as unknown as Record<symbol, harnessSchedulerRetentionSupportTypes.Sizes>)[
    SCHEDULER_INDEX_SIZES
  ]!;
}

const directories: string[] = [];

const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-retention-");
  directories.push(directory);
  return joinPath(directory, "session.sqlite");
});

const open = Effect.fn("open")(function* (storage?: Storage) {
  const opened = yield* openTasks(
    storage ?? (yield* awaited(openNodeSqliteStorage(yield* sqlitePath()))),
    [Hold, Spawner, Rejected],
  );
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  return { ...opened, root };
});

const status = Effect.fn("status")(function* (harness: Harness, id: TaskId) {
  return (yield* awaited(harness.getTask(id, context)))!.state;
});

const subagentCycle = Effect.fn("subagentCycle")(function* (
  harness: Harness,
  root: Conversation,
  parent: TaskId,
  n: number,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { tool, inner, child } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const toolInner = yield* awaited(
              tx.createTask(
                Hold,
                { name: `tool${n}` },
                { ownership: { kind: "task", taskId: parent } },
              ),
            );
            const childInner = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: toolInner } }),
            );
            const innerInner = yield* awaited(
              tx.createTask(
                Hold,
                { name: `inner${n}` },
                { conversationId: childInner.id, ownership: { kind: "conversation" } },
              ),
            );
            return { child: childInner.id, inner: innerInner, tool: toolInner };
          }),
        ),
      context,
    ),
  );
  gate(`inner${n}`).resolve();
  gate(`tool${n}`).resolve();
  yield* awaited(harness.waitForTask(inner, context));
  yield* awaited(harness.waitForTask(tool, context));
  return child;
});

const harnessSchedulerRetentionSupport = {
  Hold,
  Rejected,
  Spawner,
  directories,
  gate,
  gates,
  open,
  rejections,
  runs,
  sizes,
  sqlitePath,
  status,
  subagentCycle,
};

export default harnessSchedulerRetentionSupport;
