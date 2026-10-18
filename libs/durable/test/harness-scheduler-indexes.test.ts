import type { TaskId } from "@msa/durable";
import { createSession } from "@msa/durable/session";
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
import { deferred, eventually, openTasks, settled } from "./task-support.ts";

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

const cancellingOwnersStore = Effect.fn("cancellingOwnersStore")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const session = createSession(yield* awaited(openNodeSqliteStorage(path)));
  const ids = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const conversation = yield* awaited(
              tx.createConversation({ ownership: { kind: "ownerless" } }),
            );
            const top = yield* awaited(
              tx.createTask(
                Hold,
                { name: "top" },
                { conversationId: conversation.id, ownership: { kind: "conversation" } },
              ),
            );
            const middle = yield* awaited(
              tx.createTask(Hold, { name: "middle" }, { ownership: { kind: "task", taskId: top } }),
            );
            const leaf = yield* awaited(
              tx.createTask(
                Hold,
                { name: "leaf" },
                { ownership: { kind: "task", taskId: middle } },
              ),
            );
            return { top, middle, leaf };
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const top = (yield* awaited(tx.task(ids.top)))!;
            const middle = (yield* awaited(tx.task(ids.middle)))!;
            const set = (tx as unknown as { setTask(value: unknown): void }).setTask.bind(tx);
            set({ ...top, abortRequested: true });
            set({ ...middle, abortRequested: true, abortReason: "restart" });
          }),
        ),
      context,
    ),
  );
  yield* awaited(session.close(context));
  return { path, ids };
});

const takesCascadeReason = Effect.gen(function* () {
  const { path, ids } = yield* cancellingOwnersStore();
  const storage = yield* awaited(openNodeSqliteStorage(path));
  const reasons: (string | undefined)[] = [];
  const commit = storage.commit.bind(storage);
  storage.commit = (writes, commitContext) => {
    for (const write of writes) {
      if (write.type === "task" && write.value.id === ids.leaf && write.value.abortRequested) {
        reasons.push(write.value.abortReason);
      }
    }
    return commit(writes, commitContext);
  };
  const { harness } = yield* openTasks(storage, [Hold]);
  harness.resume();
  for (const id of [ids.leaf, ids.middle, ids.top])
    yield* awaited(harness.waitForTask(id, context));
  expect(reasons[0]).toBe("restart");
  yield* awaited(harness.close(context));
});

describe("scheduler indexes", () => {
  it("takes a cascade's reason from the nearest cancelling owner", () =>
    Effect.runPromise(takesCascadeReason));
});

const finalizesChainHeldStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = yield* awaited(openNodeSqliteStorage(yield* sqlitePath()));
  const endedIn = new Map<TaskId, number>();
  let commits = 0;
  const commit = storage.commit.bind(storage);
  storage.commit = (writes, commitContext) => {
    commits++;
    for (const write of writes) {
      if (write.type === "task" && write.value.state.status === "terminal")
        endedIn.set(write.value.id, commits);
    }
    return commit(writes, commitContext);
  };
  const opened = yield* openTasks(storage, [Hold]);
  const harness = opened.harness;
  const root = yield* awaited(harness.root(context));
  harness.resume();
  const { top, middle, leaf } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const top = yield* awaited(
              tx.createTask(Hold, { name: "top" }, { ownership: { kind: "conversation" } }),
            );
            const middle = yield* awaited(
              tx.createTask(Hold, { name: "middle" }, { ownership: { kind: "task", taskId: top } }),
            );
            const leaf = yield* awaited(
              tx.createTask(
                Hold,
                { name: "leaf" },
                { ownership: { kind: "task", taskId: middle } },
              ),
            );
            return { top, middle, leaf };
          }),
        ),
      context,
    ),
  );
  gate("top").resolve();
  return { runPromise, endedIn, harness, top, middle, leaf };
});

const finalizesChainHeld = Effect.gen(function* () {
  const { runPromise, endedIn, harness, top, middle, leaf } = yield* finalizesChainHeldStep1;
  gate("middle").resolve();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, top)).state.status === "completing";
      }),
    ),
  );
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* state(harness, middle)).state.status === "completing";
      }),
    ),
  );
  gate("leaf").resolve();
  expect((yield* awaited(harness.waitForTask(top, context))).state.outcome.status).toBe(
    "completed",
  );
  expect(endedIn.get(middle)).toBe(endedIn.get(top));
  expect(endedIn.get(middle)).toBeGreaterThan(endedIn.get(leaf)!);
  yield* awaited(harness.close(context));
});

describe("scheduler indexes", () => {
  it("finalizes a chain of held owners in the commit that frees the last one", () =>
    Effect.runPromise(finalizesChainHeld));
});

const keepsScopeBusyStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  let opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [Hold]);
  let root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  const { owner, child } = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const owner = yield* awaited(
              tx.createTask(Hold, { name: "owner" }, { ownership: { kind: "conversation" } }),
            );
            const child = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: owner } }),
            );
            return { owner, child: child.id };
          }),
        ),
      context,
    ),
  );
  gate("owner").resolve();
  yield* awaited(opened.harness.waitForTask(owner, context));
  const conversation = (yield* awaited(opened.harness.conversation(child, context)))!;
  const inner = yield* awaited(
    conversation.commit(
      (tx) => tx.createTask(Hold, { name: "inner" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  yield* awaited(opened.harness.close(context));
  gates.clear();
  const storage = yield* awaited(openNodeSqliteStorage(path));
  const read = storage.conversation.bind(storage);
  const held = deferred<void>();
  return { runPromise, child, inner, storage, read, held };
});

const keepsScopeBusy = Effect.gen(function* () {
  const { runPromise, child, inner, storage, read, held } = yield* keepsScopeBusyStep1;
  storage.conversation = (id, readContext) =>
    runPromise(
      Effect.gen(function* () {
        if (id === child) yield* awaited(held.promise);
        return yield* awaited(read(id, readContext));
      }),
    );
  const opened = yield* openTasks(storage, [Hold]);
  expect(yield* settled(opened.harness.waitForIdle(context))).toBe(false);
  held.resolve();
  const root = yield* awaited(opened.harness.root(context));
  opened.harness.resume();
  gate("inner").resolve();
  yield* awaited(opened.harness.waitForTask(inner, context));
  yield* awaited(root.waitForIdle(context));
  yield* awaited(opened.harness.close(context));
});

describe("scheduler indexes", () => {
  it("keeps a scope busy after reopen for work below an ended task whose chain is not loaded yet", () =>
    Effect.runPromise(keepsScopeBusy));
});
