import { createModels, type Message } from "@msa/ai";
import { defineTask, type EntryRecord, type Storage } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { countingSetup, runInRoot, ABORTED, DONE, probeTask } from "./harness-context-support.ts";
import { addTask, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

const keepsReturnedViews = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const opened = yield* countingSetup();
  yield* runInRoot(opened, "test.context-mutate", (runtime, taskContext) =>
    runPromise(
      Effect.gen(function* () {
        const view = yield* awaited(runtime.context(opened.root.id, taskContext));
        (view.messages as Message[]).length = 0;
        (view.entries as EntryRecord[]).pop();
        expect(() => {
          (view.contributions[0]![0] as { content: unknown }).content = "changed";
        }).toThrow(TypeError);
        expect(yield* awaited(runtime.context(opened.root.id, taskContext))).toEqual(
          yield* awaited(opened.root.context(taskContext)),
        );
      }),
    ),
  );
  yield* awaited(opened.harness.close(context));
});

describe("conversation context", () => {
  it("keeps returned views and kept ranges apart", () => Effect.runPromise(keepsReturnedViews));
});

const freezesKeptEntries = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const memory = new MemoryStorage();
  const storage = new Proxy<Storage>(memory, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (key === "scanEntries") {
        return (...args: Parameters<Storage["scanEntries"]>) =>
          runPromise(
            Effect.gen(function* () {
              const page = yield* awaited(target.scanEntries(...args));
              return {
                ...page,
                items: page.items.map((item) => Object.freeze(structuredClone(item))),
              };
            }),
          );
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const registry = createRegistry();
  const harness = yield* awaited(
    Harness.open(storage, { models: createModels(), registry }, context),
  );
  const root = yield* awaited(harness.root(context));
  yield* awaited(
    root.commit(
      (tx) => tx.appendEntry(root.id, { kind: "message", model: [user("hello")] }),
      context,
    ),
  );
  yield* runInRoot({ harness, registry, root }, "test.context-shallow", (runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        const view = yield* awaited(runtime.context(root.id, ctx));
        expect(() => {
          (view.messages[0] as { content: unknown }).content = "changed";
        }).toThrow(TypeError);
      }),
    ),
  );
  yield* awaited(harness.close(context));
});

describe("conversation context", () => {
  it("freezes kept entries deeply even when storage freezes them shallowly", () =>
    Effect.runPromise(freezesKeptEntries));
});

const doesNotKeep = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, registry, root, scanned, hold } = yield* countingSetup({
    settings: { contextRetentionMs: 0 },
  });
  const scans = Promise.withResolvers<void>();
  const probeStart = Promise.withResolvers<void>();
  let late: Promise<unknown> | undefined;
  const Late = defineTask<Record<string, never>, { phase: "run" }, null>({
    name: "test.context-late",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: (_task, runtime, taskContext) =>
        runPromise(
          Effect.gen(function* () {
            hold.scan = scans.promise;
            late = runtime.context(root.id, taskContext).catch((error: unknown) => error);
            yield* awaited(runtime.commit(() => DONE, taskContext));
          }),
        ),
    },
    abort: (_task, runtime, taskContext) =>
      runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => ABORTED, taskContext)))),
      ),
  });
  const rows: Record<string, number> = {};
  const Probe = probeTask((name, load) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(probeStart.promise);
        const before = scanned.rows;
        yield* awaited(load());
        rows[name] = scanned.rows - before;
      }),
    ),
  );
  for (const task of [Late, Probe]) addTask(registry, task);
  harness.resume();
  const options = { ownership: { kind: "conversation" }, conversationId: root.id } as const;
  const lateId = yield* awaited(harness.commit((tx) => tx.createTask(Late, {}, options), context));
  expect((yield* awaited(harness.waitForTask(lateId, context))).state.outcome).toEqual(
    DONE.outcome,
  );
  const probeId = yield* awaited(
    harness.commit((tx) => tx.createTask(Probe, { name: "probe" }, options), context),
  );
  scans.resolve();
  yield* awaited(late);
  probeStart.resolve();
  expect((yield* awaited(harness.waitForTask(probeId, context))).state.outcome).toEqual(
    DONE.outcome,
  );
  expect(rows).toEqual({ probe: 22 });
  yield* awaited(harness.close(context));
});

describe("conversation context", () => {
  it("does not keep a read that finishes after its task ended", () =>
    Effect.runPromise(doesNotKeep));
});

const dropsIdleConversation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const { harness, registry, root, scanned } = yield* countingSetup({
    settings: { contextRetentionMs: 1_000 },
  });
  const rows: Record<string, number> = {};
  const Probe = probeTask((name, load) =>
    runPromise(
      Effect.gen(function* () {
        const before = scanned.rows;
        yield* awaited(load());
        rows[name] = scanned.rows - before;
      }),
    ),
  );
  addTask(registry, Probe);
  harness.resume();
  const options = { ownership: { kind: "conversation" }, conversationId: root.id } as const;
  const probe = (name: string) =>
    runPromise(
      Effect.gen(function* () {
        const id = yield* awaited(
          harness.commit((tx) => tx.createTask(Probe, { name }, options), context),
        );
        expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual(
          DONE.outcome,
        );
        yield* awaited(root.waitForIdle(context));
      }),
    );
  const idle = vi.getTimerCount();
  yield* awaited(probe("first"));
  expect(vi.getTimerCount()).toBe(idle + 1);
  vi.advanceTimersByTime(1_000);
  expect(vi.getTimerCount()).toBe(idle);
  yield* awaited(probe("second"));
  expect(rows).toEqual({ first: 22, second: 22 });
  yield* awaited(harness.close(context));
});

describe("conversation context", () => {
  it("drops an idle conversation's context read on a timer when nothing else runs", () =>
    Effect.runPromise(dropsIdleConversation));
});

const dropsConversationContext = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, registry, root, scanned } = yield* countingSetup({
    settings: { contextRetentionMs: 0 },
  });
  const rows: Record<string, number> = {};
  const Probe = probeTask((name, load) =>
    runPromise(
      Effect.gen(function* () {
        const before = scanned.rows;
        yield* awaited(load());
        rows[name] = scanned.rows - before;
      }),
    ),
  );
  addTask(registry, Probe);
  harness.resume();
  const options = { ownership: { kind: "conversation" }, conversationId: root.id } as const;
  for (const name of ["first", "second"]) {
    const id = yield* awaited(
      harness.commit((tx) => tx.createTask(Probe, { name }, options), context),
    );
    expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual(DONE.outcome);
    yield* awaited(root.waitForIdle(context));
  }
  expect(rows).toEqual({ first: 22, second: 22 });
  yield* awaited(harness.close(context));
});

describe("conversation context", () => {
  it("drops a conversation's context read once idle with zero retention", () =>
    Effect.runPromise(dropsConversationContext));
});
