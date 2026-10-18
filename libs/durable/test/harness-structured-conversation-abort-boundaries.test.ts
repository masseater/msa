import { type ConversationId, type TaskId } from "@msa/durable";
import { createSession } from "@msa/durable/session";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import {
  state,
  outcomeOf,
  open,
  gates,
  until,
  start,
  Node,
  behaviors,
  log,
  OWN_CONVERSATION,
  openNodes,
  parentOf,
  script,
  spawnAndFinish,
  directories,
  sqlitePath,
} from "./harness-structured-support.ts";
import { awaited, removeDir, ControlledStorage, context, openTasks, settled } from "./support.ts";

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
  let reject: TaskId | undefined;
  const failure = new Error("disk gone");
  class Failing extends ControlledStorage {
    override commit(
      writes: Parameters<MemoryStorage["commit"]>[0],
      ctx: Parameters<MemoryStorage["commit"]>[1],
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
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: failure });
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
            return { owner, inner };
          }),
        ),
      context,
    ),
  );
  return { runPromise, path, session, tree };
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
  return { runPromise, path };
});

const keepsRootBusy = Effect.gen(function* () {
  const { runPromise, path } = yield* keepsRootBusyStep1;
  let inner: TaskId | undefined;
  script("child", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
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
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
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
  return { runPromise, path };
});

const keepsFinishedBackgroundStep2 = Effect.gen(function* () {
  const { runPromise, path } = yield* keepsFinishedBackgroundStep1;
  let conversation: ConversationId | undefined;
  script("child", {
    run: (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          yield* awaited(
            runtime.commit(
              (tx) =>
                runPromise(
                  Effect.gen(function* () {
                    conversation = (yield* awaited(
                      tx.createConversation({
                        ownership: { kind: "task", taskId: runtime.taskId },
                      }),
                    )).id;
                    return { status: "running", checkpoint: { phase: "resume", round: 1 } };
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
  return { opened, below };
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
