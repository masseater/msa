import { createModels, fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";
import { type ConversationId, defineTool, type Storage, type TaskId } from "@msa/durable";
import { createRegistry, GenerationTask, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { start, oneStep, storageOpen, withSignal } from "./harness-lifecycle-support.ts";
import {
  chatSetup,
  openChat,
  abortController,
  awaited,
  addHooks,
  addTool,
  ControlledStorage,
  context,
  countingReader,
  deferred,
  openTasks,
  settled,
} from "./support.ts";

const seedRunningTask = Effect.fn("seedRunningTask")(function* (storage: Storage) {
  const conversationId = yield* awaited(storage.mintId<ConversationId>());
  const id = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  const state = { status: "running", checkpoint: { phase: "run" } } as const;
  const task = {
    id,
    conversationId,
    kind: "test.seeded",
    version: 1,
    input: null,
    background: false,
    state,
  };
  yield* awaited(
    storage.commit(
      [
        { type: "conversation", value: { id: conversationId } },
        { type: "task", value: { ...task, abortRequested: false } },
      ],
      context,
    ),
  );
});

const closesWithoutCancelled = Effect.gen(function* () {
  const storage = new ControlledStorage();
  yield* seedRunningTask(storage);
  const reader = countingReader(createRegistry());
  const held = storage.holdCommits();
  storage.failNextCommit(new Error("disk full"));
  const controller = abortController();
  const opening = Harness.open(
    storage,
    { models: createModels(), registry: reader },
    withSignal(controller.signal),
  );
  yield* awaited(held.entered);
  controller.abort(new Error("caller gave up"));
  held.release();
  yield* awaited(expect(opening).rejects.toThrow("disk full"));
  expect(reader.subscriptions()).toBe(0);
  expect(yield* awaited(storageOpen(storage))).toBe(false);
});

const rethrowsOpenError = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  class FailingClose extends ControlledStorage {
    override close(closeContext: Context): Promise<void> {
      const superClose = super.close.bind(this);
      return runPromise(
        Effect.gen(function* () {
          yield* awaited(superClose(closeContext));
          throw new Error("close failed");
        }),
      );
    }
  }
  const storage = new FailingClose();
  yield* seedRunningTask(storage);
  storage.failNextCommit(new Error("disk full"));
  const reports: unknown[] = [];
  const opening = Harness.open(
    storage,
    {
      models: createModels(),
      registry: createRegistry(),
      onReport: (error) => reports.push(error),
    },
    context,
  );
  yield* awaited(expect(opening).rejects.toThrow("disk full"));
  expect(reports).toEqual([new Error("disk full")]);
});

describe("Harness open", () => {
  it("closes without a cancelled caller context and rethrows the original error when open fails", () =>
    Effect.runPromise(closesWithoutCancelled));

  it("rethrows the open error and reports it once, though closing then fails too", () =>
    Effect.runPromise(rethrowsOpenError));
});

const joinsTaskHandler = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new MemoryStorage();
  const reached = deferred();
  const gate = deferred();
  let readAfterRelease: boolean | undefined;
  const Stubborn = oneStep("test.close-stubborn", () =>
    runPromise(
      Effect.gen(function* () {
        reached.resolve();
        yield* awaited(gate.promise);
        readAfterRelease = yield* awaited(storageOpen(storage));
      }),
    ),
  );
  const { harness } = yield* openTasks(storage, [Stubborn]);
  yield* awaited(start(yield* awaited(harness.root(context)), Stubborn));
  harness.resume();
  yield* awaited(reached.promise);
  const closing = harness.close(context);
  expect(yield* settled(closing)).toBe(false);
  expect(yield* awaited(storageOpen(storage))).toBe(true);
  gate.resolve();
  yield* awaited(closing);
  expect(readAfterRelease).toBe(true);
  expect(yield* awaited(storageOpen(storage))).toBe(false);
});

describe("Harness close", () => {
  it("joins a task handler that ignores its signal before closing Storage", () =>
    Effect.runPromise(joinsTaskHandler));
});

const stubbornSetup = (where: "tool" | "hook") => {
  const setup = chatSetup();
  const storage = new MemoryStorage();
  const reached = deferred();
  const gate = deferred();
  const observed: { readAfterRelease?: boolean } = {};
  const stubborn = (): Promise<void> =>
    Effect.runPromise(
      Effect.gen(function* () {
        reached.resolve();
        yield* awaited(gate.promise);
        observed.readAfterRelease = yield* awaited(storageOpen(storage));
      }),
    );
  addTool(
    setup.registry,
    defineTool({
      name: "wait",
      description: "wait",
      parameters: Type.Object({}),
      execute: () =>
        (where === "tool" ? stubborn() : Promise.resolve()).then(() => ({ output: [] })),
    }),
  );
  addHooks(setup.registry, GenerationTask, {
    beforeRequest: () => (where === "hook" ? stubborn() : Promise.resolve()).then(() => undefined),
  });
  setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {}, { id: "c1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  return { setup, storage, reached, gate, observed };
};

const joinsToolExecute = Effect.gen(function* () {
  for (const where of ["tool", "hook"] as const) {
    const { setup, storage, reached, gate, observed } = stubbornSetup(where);
    const { harness, root } = yield* openChat(storage, setup);
    yield* awaited(root.submit({ type: "input", content: "go" }, context));
    yield* awaited(reached.promise);
    const closing = harness.close(context);
    expect(yield* settled(closing)).toBe(false);
    expect(yield* awaited(storageOpen(storage))).toBe(true);
    gate.resolve();
    yield* awaited(closing);
    expect(observed.readAfterRelease).toBe(true);
    expect(yield* awaited(storageOpen(storage))).toBe(false);
  }
});

describe("Harness close", () => {
  it("joins a tool execute and a hook that ignore their signal before closing Storage", () =>
    Effect.runPromise(joinsToolExecute));
});

const keepsShuttingDown = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new MemoryStorage();
  const reached = deferred();
  const gate = deferred();
  const Stubborn = oneStep("test.close-cancelled", () =>
    runPromise(
      Effect.gen(function* () {
        reached.resolve();
        yield* awaited(gate.promise);
      }),
    ),
  );
  const { harness } = yield* openTasks(storage, [Stubborn]);
  yield* awaited(start(yield* awaited(harness.root(context)), Stubborn));
  harness.resume();
  yield* awaited(reached.promise);
  const controller = abortController();
  const cancelled = harness.close(withSignal(controller.signal));
  controller.abort(new Error("stop waiting"));
  yield* awaited(expect(cancelled).rejects.toThrow("stop waiting"));
  yield* awaited(expect(harness.commit(() => {}, context)).rejects.toThrow("closed"));
  expect(yield* awaited(storageOpen(storage))).toBe(true);
  const second = harness.close(context);
  expect(yield* settled(second)).toBe(false);
  gate.resolve();
  yield* awaited(second);
  expect(yield* awaited(storageOpen(storage))).toBe(false);
});

const settlesDurablyCommit = Effect.gen(function* () {
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, []);
  const root = yield* awaited(harness.root(context));
  const held = storage.holdCommits();
  const controller = abortController();
  const committing = root.commit(
    (tx) => tx.appendEntry(root.id, { kind: "note" }).then((entry) => entry.id),
    withSignal(controller.signal),
  );
  yield* awaited(held.entered);
  controller.abort(new Error("committer gave up"));
  held.release();
  const id = yield* awaited(committing);
  const page = yield* awaited(root.entries({}, 10, undefined, context));
  expect(page.items.map((entry) => entry.id)).toEqual([id]);
  yield* awaited(harness.close(context));
});

describe("Harness close", () => {
  it("keeps shutting down after a cancelled close, and a second close awaits the same shutdown", () =>
    Effect.runPromise(keepsShuttingDown));

  it("settles durably a commit whose committer was cancelled while it was in Storage", () =>
    Effect.runPromise(settlesDurablyCommit));
});
