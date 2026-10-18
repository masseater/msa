import { LiveDoc, type Storage } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { awaited } from "./effect-support.ts";
import {
  status,
  sizes,
  subagentCycle,
  gate,
  gates,
  Hold,
  runs,
  directories,
  sqlitePath,
  open,
  rejections,
  Spawner,
} from "./harness-scheduler-retention-support.ts";
import { removeDir } from "./platform-support.ts";
import { context } from "./session-support.ts";
import { eventually } from "./task-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      gates.clear();
      runs.clear();
      rejections.length = 0;
      for (const directory of directories.splice(0)) yield* removeDir(directory);
    }),
  ),
);

function countReads(storage: Storage): { tasks: number; conversations: number } {
  const reads = { tasks: 0, conversations: 0 };
  const task = storage.task.bind(storage);
  const conversation = storage.conversation.bind(storage);
  storage.task = (id, readContext) => {
    reads.tasks++;
    return task(id, readContext);
  };
  storage.conversation = (id, readContext) => {
    reads.conversations++;
    return conversation(id, readContext);
  };
  return reads;
}

const forgetsEndedSubagent = Effect.gen(function* () {
  const { harness, root } = yield* open();
  const parent = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Hold, { name: "parent" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  yield* subagentCycle(harness, root, parent, 0);
  const baseline = sizes(harness);
  for (const n of Array.from({ length: 200 }, (_, i) => 1 + i))
    yield* subagentCycle(harness, root, parent, n);
  expect(sizes(harness)).toEqual(baseline);
  gate("parent").resolve();
  yield* awaited(harness.waitForTask(parent, context));
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("forgets ended subagent chains once their work ends", () =>
    Effect.runPromise(forgetsEndedSubagent));
});

const holdsLiveOwner = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = yield* awaited(openNodeSqliteStorage(yield* sqlitePath()));
  const reads = countReads(storage);
  const { harness, root } = yield* open(storage);
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } }),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } }),
            );
            const a = yield* awaited(
              tx.createTask(Hold, { name: "a" }, { ownership: { kind: "task", taskId: b } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: a } }),
            );
            return { p, b, a, c: c.id };
          }),
        ),
      context,
    ),
  );
  gate("a").resolve();
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  const before = sizes(harness);
  const loaded = reads.tasks + reads.conversations;
  const c = (yield* awaited(harness.conversation(tree.c, context)))!;
  const d = yield* awaited(
    c.commit(
      (tx) => tx.createTask(Hold, { name: "d" }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  gate("p").resolve();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* status(harness, tree.p)).status === "completing";
      }),
    ),
  );
  expect(reads.tasks + reads.conversations).toBeGreaterThan(loaded);
  gate("d").resolve();
  expect((yield* awaited(harness.waitForTask(d, context))).state.outcome.status).toBe("completed");
  expect((yield* awaited(harness.waitForTask(tree.p, context))).state.outcome.status).toBe(
    "completed",
  );
  expect(sizes(harness).settled).toBeLessThanOrEqual(before.settled);
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("holds a live owner for work later created in a forgotten conversation, loading its chain again", () =>
    Effect.runPromise(holdsLiveOwner));
});

const holdsOwnerWork = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* open();
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(
                Spawner,
                { name: "p", into: 0 },
                { ownership: { kind: "conversation" } },
              ),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } }),
            );
            const a = yield* awaited(
              tx.createTask(Hold, { name: "a" }, { ownership: { kind: "task", taskId: b } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: a } }),
            );
            return { p, b, c: c.id };
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const record = (yield* awaited(tx.task(tree.p)))!;
            (tx as unknown as { setTask(value: unknown): void }).setTask({
              ...record,
              input: { name: "p", into: tree.c },
            });
          }),
        ),
      context,
    ),
  );
  gate("a").resolve();
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  gate("p").resolve();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* status(harness, tree.p)).status !== "running";
      }),
    ),
  );
  expect((yield* status(harness, tree.p)).status).toBe("completing");
  gate("inside.p").resolve();
  expect((yield* awaited(harness.waitForTask(tree.p, context))).state.outcome.status).toBe(
    "completed",
  );
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("holds an owner for work its own terminal commit creates below a forgotten chain", () =>
    Effect.runPromise(holdsOwnerWork));
});

const withdrawsInputQueued = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root } = yield* open();
  const tree = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const p = yield* awaited(
              tx.createTask(Hold, { name: "p" }, { ownership: { kind: "conversation" } }),
            );
            const b = yield* awaited(
              tx.createTask(Hold, { name: "b" }, { ownership: { kind: "task", taskId: p } }),
            );
            const c = yield* awaited(
              tx.createConversation({ ownership: { kind: "task", taskId: b } }),
            );
            const keep = yield* awaited(
              tx.createTask(Hold, { name: "keep" }, { ownership: { kind: "task", taskId: p } }),
            );
            return { p, b, c: c.id, keep };
          }),
        ),
      context,
    ),
  );
  gate("b").resolve();
  yield* awaited(harness.waitForTask(tree.b, context));
  const c = (yield* awaited(harness.conversation(tree.c, context)))!;
  yield* awaited(
    c.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, tree.c))).run = { taskId: tree.keep, inputs: [] };
          }),
        ),
      context,
    ),
  );
  const queued = (yield* awaited(c.submit({ type: "input", content: "later" }, context))).id;
  yield* awaited(harness.abortTask(tree.p, context));
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        const settledState = yield* awaited(
          (yield* awaited(harness.submission(queued, context)))!.status(context),
        );
        return settledState.status === "unanswered";
      }),
    ),
  );
  expect(
    yield* awaited((yield* awaited(harness.submission(queued, context)))!.status(context)),
  ).toMatchObject({
    reason: "aborted",
  });
  yield* awaited(harness.waitForTask(tree.p, context));
  yield* awaited(harness.close(context));
});

describe("scheduler retention", () => {
  it("withdraws an input queued in a forgotten conversation below an abort-marked owner", () =>
    Effect.runPromise(withdrawsInputQueued));
});
