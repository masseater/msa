import {
  type Conversation,
  defineTask,
  type Harness,
  type Storage,
  type TaskId,
} from "@msa/durable";
import { Effect } from "effect";

import { SCHEDULER_INDEX_SIZES } from "../src/harness/harness.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import { joinPath, makeTempDir } from "./platform-support.ts";
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

export const runs = new Map<string, number>();

export const Hold = defineTask<{ name: string }, { phase: "hold" }, null>({
  name: "test.retention.hold",
  version: 1,
  initial: () => ({ phase: "hold" }),
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

export const Spawner = defineTask<{ name: string; into: number }, { phase: "hold" }, null>({
  name: "test.retention.spawner",
  version: 1,
  initial: () => ({ phase: "hold" }),
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
                          ownership: { kind: "conversation" },
                          conversationId: task.input.into as never,
                        },
                      ),
                    );
                    return { status: "terminal", outcome: { status: "completed", result: null } };
                  }),
                ),
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

export const rejections: unknown[] = [];

export const Rejected = defineTask<{ into: number }, { phase: "hold" }, null>({
  name: "test.retention.rejected",
  version: 1,
  initial: () => ({ phase: "hold" }),
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
                          ownership: { kind: "conversation" },
                          conversationId: task.input.into as never,
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
                    return { status: "terminal", outcome: { status: "completed", result: null } };
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

export const sqlitePath = Effect.fn("sqlitePath")(function* () {
  const directory = yield* makeTempDir("msa-durable-retention-");
  directories.push(directory);
  return joinPath(directory, "session.sqlite");
});

export const open = Effect.fn("open")(function* (storage?: Storage) {
  const opened = yield* openTasks(
    storage ?? (yield* awaited(openNodeSqliteStorage(yield* sqlitePath()))),
    [Hold, Spawner, Rejected],
  );
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  return { ...opened, root };
});

export const status = Effect.fn("status")(function* (harness: Harness, id: TaskId) {
  return (yield* awaited(harness.getTask(id, context)))!.state;
});

export const subagentCycle = Effect.fn("subagentCycle")(function* (
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
            const tool = yield* awaited(
              tx.createTask(
                Hold,
                { name: `tool${n}` },
                { ownership: { kind: "task", taskId: parent } },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: tool } }),
            );
            const inner = yield* awaited(
              tx.createTask(
                Hold,
                { name: `inner${n}` },
                { ownership: { kind: "conversation" }, conversationId: child.id },
              ),
            );
            return { tool, inner, child: child.id };
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
