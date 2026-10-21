import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import node from "../src/storage/sqlite/node.ts";
import effectSupport from "./effect-support.ts";
import harnessOwnershipSupport from "./harness-ownership-support.ts";
import platformSupport from "./platform-support.ts";
import sessionSupport from "./session-support.ts";

const { openNodeSqliteStorage } = node;

const { abortController, awaited } = effectSupport;
const { Hold, Waiter, directories, gates, open, openHarness, ownedChild, runs, status, waitUntil } =
  harnessOwnershipSupport;
const { joinPath, makeTempDir, removeDir } = platformSupport;
const { context } = sessionSupport;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      runs.clear();
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const cancelsOnlyCaller = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const tree = yield* awaited(ownedChild(root, "owner"));
  const waiting = abortController();
  const idle = root.waitForIdle({ ...context, abortSignal: waiting.signal });
  waiting.abort(new Error("stop waiting"));
  yield* awaited(expect(idle).rejects.toThrow("stop waiting"));
  expect((yield* status(harness, tree.inner)).status).not.toBe("terminal");

  const slow = yield* awaited(ownedChild(root, "slow"));
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(slow.owner)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              input: { name: "slow", slowAbort: true },
            });
          }),
        ),
      context,
    ),
  );
  const aborting = abortController();
  const abort = root.abort({ ...context, abortSignal: aborting.signal });
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* awaited(harness.getTask(slow.owner, context)))!.abortRequested;
    }),
  );
  aborting.abort(new Error("stop aborting"));
  yield* awaited(expect(abort).rejects.toThrow("stop aborting"));
  open("abort.slow", "completed");
  for (const id of [tree.owner, tree.inner, slow.owner, slow.inner]) {
    expect((yield* awaited(harness.waitForTask(id, context))).state.outcome.status).toBe("aborted");
  }
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("cancels only the caller's wait, never the shared work", () =>
    Effect.runPromise(cancelsOnlyCaller));
});

const abortsWaitingChildStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* openHarness();
  const { owner, dependency, blocked } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const ownerInner = yield* awaited(
              tx.createTask(Hold, { name: "owner" }, { ownership: { kind: "conversation" } }),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: ownerInner } }),
            );
            const dependencyInner = yield* awaited(
              tx.createTask(Hold, { name: "dependency" }, { ownership: { kind: "conversation" } }),
            );
            const blockedInner = yield* awaited(
              tx.createTask(
                Waiter,
                { on: [dependencyInner] },
                { conversationId: child.id, ownership: { kind: "conversation" } },
              ),
            );
            return { blocked: blockedInner, dependency: dependencyInner, owner: ownerInner };
          }),
        ),
      context,
    ),
  );
  yield* waitUntil(Effect.sync(() => runs.get("dependency") === 1 && runs.get("owner") === 1));
  yield* waitUntil(
    Effect.gen(function* () {
      return (yield* status(harness, blocked)).status === "waiting";
    }),
  );
  return { blocked, dependency, harness, owner, root, runPromise };
});

const abortsWaitingChild = Effect.gen(function* () {
  const { runPromise, harness, root, owner, dependency, blocked } = yield* abortsWaitingChildStep1;
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const setTask = (value: unknown) =>
              (tx as unknown as { setTask(value: unknown): void }).setTask(value);
            const completedDependency = (yield* awaited(tx.task(dependency)))!;
            const marked = (yield* awaited(tx.task(owner)))!;
            setTask({
              ...completedDependency,
              state: { outcome: { result: null, status: "completed" }, status: "terminal" },
            });
            setTask({ ...marked, abortRequested: true });
          }),
        ),
      context,
    ),
  );
  expect((yield* awaited(harness.waitForTask(blocked, context))).state.outcome.status).toBe(
    "aborted",
  );
  yield* awaited(harness.close(context));
});

describe("ownership", () => {
  it("aborts a waiting child whose awaited task completes in the commit that marks its owner", () =>
    Effect.runPromise(abortsWaitingChild));
});

const appliesMarksFoundStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const directory = yield* makeTempDir("msa-durable-ownership-");
  directories.add(directory);
  const path = joinPath(directory, "session.sqlite");
  return { path, runPromise };
});

const appliesMarksFound = Effect.gen(function* () {
  const { runPromise, path } = yield* appliesMarksFoundStep1;
  let opened = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  const tree = yield* awaited(ownedChild(opened.root, "owner", { slowOwner: true }));
  open("owner.inner", "completed");
  yield* awaited(opened.harness.waitForTask(tree.inner, context));
  yield* awaited(opened.harness.abortTask(tree.owner, context));
  yield* awaited(opened.harness.close(context));

  const storage = yield* awaited(openNodeSqliteStorage(path));
  let rejectMark: durableTypes.TaskId | undefined;
  const commit = storage.commit.bind(storage);
  storage.commit = (writes, ctx) => {
    if (
      writes.some(
        (write) =>
          write.type === "task" && write.value.id === rejectMark && write.value.abortRequested,
      )
    ) {
      rejectMark = undefined;
      return Promise.reject(new Error("disk gone"));
    }
    return Promise.resolve(commit(writes, ctx));
  };
  opened = yield* openHarness(storage);
  const child = (yield* awaited(opened.harness.conversation(tree.child, context)))!;
  const late = yield* awaited(
    child.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const id = yield* awaited(
              tx.createTask(Hold, { name: "late" }, { ownership: { kind: "conversation" } }),
            );
            rejectMark = id;
            return id;
          }),
        ),
      context,
    ),
  );
  open("abort.owner", "completed");
  expect(yield* awaited(opened.harness.closed)).toMatchObject({ reason: "failed" });
  yield* awaited(opened.harness.close(context));
  opened = yield* openHarness(yield* awaited(openNodeSqliteStorage(path)));
  expect((yield* awaited(opened.harness.waitForTask(late, context))).state.outcome.status).toBe(
    "aborted",
  );
  yield* awaited(opened.harness.close(context));
});

describe("ownership", () => {
  it("applies marks found through an edge loaded after reopen once a failed cascade commit is reopened", () =>
    Effect.runPromise(appliesMarksFound));
});
