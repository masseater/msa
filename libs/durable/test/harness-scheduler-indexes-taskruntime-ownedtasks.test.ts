import { defineTask } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import {
  runtimes,
  owned,
  state,
  directories,
  sqlitePath,
  gates,
  gate,
  Hold,
} from "./harness-scheduler-indexes-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { aborted, eventually, openTasks } from "./task-support.ts";

const Probe = defineTask<{ name: string }, { phase: "look" }, null>({
  name: "test.index.probe",
  version: 1,
  initial: () => ({ phase: "look" }),
  phases: {
    look: (task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          runtimes.set(task.input.name, runtime);
          yield* awaited(
            Promise.race([gate(`look.${task.input.name}`).promise, aborted(runtime.signal)]),
          );
          owned.set(
            task.input.name,
            (yield* awaited(runtime.ownedTasks(ctx))).map((record) => record.id),
          );
          yield* awaited(Promise.race([gate(task.input.name).promise, aborted(runtime.signal)]));
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

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      owned.clear();
      runtimes.clear();
      for (const directory of directories.splice(0)) yield* removeDir(directory);
    }),
  ),
);

const ownedTasksBeforeReopen = Effect.fn("ownedTasksBeforeReopen")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Hold, Probe]);
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  const ids = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const probe = yield* awaited(
              tx.createTask(Probe, { name: "probe" }, { ownership: { kind: "conversation" } }),
            );
            const first = yield* awaited(
              tx.createTask(
                Hold,
                { name: "first" },
                { ownership: { kind: "task", taskId: probe } },
              ),
            );
            const ends = yield* awaited(
              tx.createTask(Hold, { name: "ends" }, { ownership: { kind: "task", taskId: probe } }),
            );
            const second = yield* awaited(
              tx.createTask(
                Hold,
                { name: "second" },
                { ownership: { kind: "task", taskId: probe } },
              ),
            );
            yield* awaited(
              tx.createTask(
                Hold,
                { name: "grandchild" },
                { ownership: { kind: "task", taskId: first } },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: probe } }),
            );
            yield* awaited(
              tx.createTask(
                Hold,
                { name: "inside" },
                { ownership: { kind: "conversation" }, conversationId: child.id },
              ),
            );
            return { probe, first, ends, second };
          }),
        ),
      context,
    ),
  );
  gate("ends").resolve();
  yield* awaited(opened.harness.waitForTask(ids.ends, context));
  return { path, opened, ids };
});

const listsLiveTasks = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path, opened, ids } = yield* ownedTasksBeforeReopen();
  gate("first").resolve();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(opened.harness, ids.first)).state.status === "completing";
      }),
    ),
  );
  gate("look.probe").resolve();
  yield* eventually(() => owned.has("probe"));
  expect(owned.get("probe")).toEqual([ids.first, ids.second]);
  yield* awaited(opened.harness.close(context));

  gates.clear();
  owned.clear();
  const reopened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Hold, Probe]);
  reopened.harness.resume();
  gate("look.probe").resolve();
  yield* eventually(() => owned.has("probe"));
  expect(owned.get("probe")).toEqual([ids.first, ids.second]);
  yield* awaited(reopened.harness.close(context));
});

const rejectsOnceInvocation = Effect.gen(function* () {
  const opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(yield* sqlitePath())), [
    Hold,
    Probe,
  ]);
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  const probe = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Probe, { name: "probe" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  yield* eventually(() => runtimes.has("probe"));
  const runtime = runtimes.get("probe")!;
  yield* awaited(opened.harness.abortTask(probe, context));
  yield* awaited(expect(runtime.ownedTasks(context)).rejects.toThrow("invocation has ended"));
  yield* awaited(opened.harness.close(context));
});

describe("TaskRuntime.ownedTasks", () => {
  it("lists the live tasks a task owns directly, in ID order, also after a reopen", () =>
    Effect.runPromise(listsLiveTasks));

  it("rejects once its invocation has ended", () => Effect.runPromise(rejectsOnceInvocation));
});
