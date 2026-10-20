import type durableTypes from "@msa/durable/index.types";
import sessionModule from "@msa/durable/session";
import type memoryTypes from "@msa/durable/storage/memory.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import harnessStructuredEvents from "./harness-structured-events.ts";
import harnessStructuredSupport from "./harness-structured-support.ts";
import support from "./support.ts";

const { createSession } = sessionModule;
const { openNodeSqliteStorage } = node;

const { spawnAndFinish } = harnessStructuredEvents;
const {
  Node,
  OWN_CONVERSATION,
  behaviors,
  directories,
  gates,
  log,
  open,
  openNodes,
  outcomeOf,
  parentOf,
  script,
  sqlitePath,
  start,
  state,
  until,
} = harnessStructuredSupport;
const { ControlledStorage, awaited, context, openTasks, removeDir, settled } = support;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      behaviors.clear();
      gates.clear();
      log.length = 0;
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const failsHarnessFailed = Effect.gen(function* () {
  let reject: durableTypes.TaskId | undefined;
  const failure = new Error("disk gone");
  class Failing extends ControlledStorage {
    override commit(
      writes: Parameters<memoryTypes.MemoryStorage["commit"]>[0],
      ctx: Parameters<memoryTypes.MemoryStorage["commit"]>[1],
    ) {
      const finalizes = writes.some(
        (write) =>
          write.type === "task" &&
          write.value.id === reject &&
          write.value.state.status === "terminal",
      );
      if (finalizes) {
        reject = undefined;
        return Promise.reject(failure);
      }
      return Promise.resolve(super.commit(writes, ctx));
    }
  }
  const storage = new Failing();
  const { harness, root, reports } = yield* openNodes(storage);
  spawnAndFinish("parent", "child");
  const parent = yield* awaited(start(root, "parent"));
  yield* until(
    Effect.gen(function* () {
      return (yield* state(harness, parent)).status === "completing";
    }),
  );
  reject = parent;
  open("child");
  expect(yield* awaited(harness.closed)).toEqual({ error: failure, reason: "failed" });
  expect(reports).toEqual([failure]);
  yield* awaited(harness.close(context));
  const reopened = yield* openNodes(storage.reopen());
  expect(yield* awaited(outcomeOf(reopened.harness, parent))).toBe("completed");
  yield* awaited(reopened.harness.close(context));
});

describe("conversation abort and boundaries", () => {
  it("fails the Harness on a failed finalization, which reopening applies", () =>
    Effect.runPromise(failsHarnessFailed));
});

const showsAbortMarkedStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const session = createSession(yield* awaited(openNodeSqliteStorage(path)));
  const tree = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const conversation = yield* awaited(
              tx.createConversation({ ownership: { kind: "ownerless" } }),
            );
            const owner = yield* awaited(
              tx.createTask(
                Node,
                { name: "owner" },
                { ...OWN_CONVERSATION, conversationId: conversation.id },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: owner } }),
            );
            const inner = yield* awaited(
              tx.createTask(
                Node,
                { name: "inner" },
                { ...OWN_CONVERSATION, conversationId: child.id },
              ),
            );
            return { inner, owner };
          }),
        ),
      context,
    ),
  );
  return { path, runPromise, session, tree };
});

const showsAbortMarked = Effect.gen(function* () {
  const { runPromise, path, session, tree } = yield* showsAbortMarkedStep1;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(tree.owner)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              abortRequested: true,
            });
          }),
        ),
      context,
    ),
  );
  yield* awaited(session.close(context));

  const { harness } = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Node]);
  const inspected = (yield* awaited(harness.inspect(context))).tasks.find(
    (task) => task.record.id === tree.owner,
  );
  expect(inspected?.state).toEqual({ kind: "waiting", on: [tree.inner] });
  harness.resume();
  expect(yield* awaited(outcomeOf(harness, tree.owner))).toBe("aborted");
  expect(log.filter((line) => line.startsWith("abort:"))).toEqual(["abort:inner", "abort:owner"]);
  yield* awaited(harness.close(context));
});

describe("recovery through ownership edges", () => {
  it("shows an abort-marked owner waiting for work in its owned conversation before resume after reopen", () =>
    Effect.runPromise(showsAbortMarked));
});

const keepsRootBusyStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  return { path, runPromise };
});

const keepsRootBusy = Effect.gen(function* () {
  const { runPromise, path } = yield* keepsRootBusyStep1;
  let inner: durableTypes.TaskId | undefined;
  script("child", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runNested2 = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runNested2(
                  Effect.gen(function* () {
                    const conversation = yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    );
                    inner = yield* awaited(
                      tx.createTask(
                        Node,
                        { name: "inner" },
                        { ...OWN_CONVERSATION, conversationId: conversation.id },
                      ),
                    );
                    return { checkpoint: { phase: "resume", round: 1 }, status: "running" };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  parentOf("parent", ["child"], "allSettled");
  let opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  const parent = yield* awaited(start(opened.root, "parent"));
  yield* until(() => log.includes("run:inner"));
  yield* awaited(opened.harness.close(context));

  opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  expect(yield* settled(opened.root.waitForIdle(context))).toBe(false);
  open("inner");
  yield* awaited(opened.root.waitForIdle(context));
  expect(yield* awaited(outcomeOf(opened.harness, parent))).toBe("completed");
  expect(inner).toBeDefined();
  yield* awaited(opened.harness.close(context));
});

describe("recovery through ownership edges", () => {
  it("keeps the root busy after reopen for work below a child task's owned conversation", () =>
    Effect.runPromise(keepsRootBusy));
});

const keepsFinishedBackgroundStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  return { path, runPromise };
});

const keepsFinishedBackgroundStep2 = Effect.gen(function* () {
  const { runPromise, path } = yield* keepsFinishedBackgroundStep1;
  let conversation: durableTypes.ConversationId | undefined;
  script("child", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runNested = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runNested(
                  Effect.gen(function* () {
                    conversation = (yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    )).id;
                    return { checkpoint: { phase: "resume", round: 1 }, status: "running" };
                  }),
                ),
              ctx,
            ),
          );
        }),
      ),
  });
  parentOf("background", ["child"], "allSettled");
  let opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  const background = yield* awaited(
    start(opened.root, "background", {
      ...OWN_CONVERSATION,
      background: true,
    }),
  );
  yield* awaited(opened.harness.waitForTask(background, context));
  yield* awaited(opened.harness.close(context));

  opened = yield* openNodes(yield* awaited(openNodeSqliteStorage(path)));
  const below = yield* awaited(
    start((yield* awaited(opened.harness.conversation(conversation!, context)))!, "below"),
  );
  yield* until(() => log.includes("run:below"));
  return { below, opened };
});

const keepsFinishedBackground = Effect.gen(function* () {
  const { opened, below } = yield* keepsFinishedBackgroundStep2;
  yield* awaited(opened.root.waitForIdle(context));
  yield* awaited(opened.root.abort(context));
  expect((yield* state(opened.harness, below)).status).toBe("running");
  yield* awaited(opened.root.abort(context, { background: true }));
  expect(yield* awaited(outcomeOf(opened.harness, below))).toBe("aborted");
  yield* awaited(opened.harness.close(context));
});

describe("recovery through ownership edges", () => {
  it("keeps a finished background ancestor a boundary after reopen, which { background: true } crosses", () =>
    Effect.runPromise(keepsFinishedBackground));
});
