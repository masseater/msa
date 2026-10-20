import { type Message, createModels } from "@msa/ai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import memoryModule from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import harnessContextSupport from "./harness-context-support.ts";
import testSupport from "./support.ts";

const { MemoryStorage } = memoryModule;
const { Harness, createRegistry } = harnessModule;
const { defineTask } = durable;

const { awaited } = testSupport;
const { ABORTED, DONE, countingSetup, probeTask, runInRoot } = harnessContextSupport;
const { addTask, user } = testSupport;
const { context } = testSupport;

afterEach(() => {
  vi.restoreAllMocks();
});

const keepsReturnedViews = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const opened = yield* countingSetup();
  yield* runInRoot(opened, "test.context-mutate", (runtime, taskContext) =>
    runPromise(
      Effect.gen(function* () {
        const view = yield* awaited(runtime.context(opened.root.id, taskContext));
        (view.messages as Message[]).length = 0;
        (view.entries as durableTypes.EntryRecord[]).pop();
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
  const memory = new MemoryStorage();
  const storage = new Proxy<durableTypes.Storage>(memory, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (key === "scanEntries") {
        return (...args: Parameters<durableTypes.Storage["scanEntries"]>) =>
          target.scanEntries(...args).then((page) => ({
            ...page,
            items: page.items.map((item) => Object.freeze(structuredClone(item))),
          }));
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
    runtime.context(root.id, ctx).then((view) => {
      expect(() => {
        (view.messages[0] as { content: unknown }).content = "changed";
      }).toThrow(TypeError);
      return undefined;
    }),
  );
  yield* awaited(harness.close(context));
});

describe("conversation context", () => {
  it("freezes kept entries deeply even when storage freezes them shallowly", () =>
    Effect.runPromise(freezesKeptEntries));
});

type CountingSetup = Effect.Success<ReturnType<typeof countingSetup>>;

const lateContextTask = (options: {
  readonly hold: CountingSetup["hold"];
  readonly scan: Promise<void>;
  readonly root: CountingSetup["root"];
  readonly seen: { late?: Promise<unknown> };
}) =>
  defineTask<Record<string, never>, { phase: "run" }, null>({
    abort: (_task, runtime, taskContext) =>
      runtime.commit(() => ABORTED, taskContext).then(() => undefined),
    initial: () => ({ phase: "run" }),
    name: "test.context-late",
    phases: {
      run: (_task, runtime, taskContext) => {
        options.hold.scan = options.scan;
        options.seen.late = runtime
          .context(options.root.id, taskContext)
          .catch((error: unknown) => error);
        return runtime.commit(() => DONE, taskContext).then(() => undefined);
      },
    },
    version: 1,
  });

const doesNotKeep = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, registry, root, scanned, hold } = yield* countingSetup({
    settings: { contextRetentionMs: 0 },
  });
  const scans = Promise.withResolvers<void>();
  const probeStart = Promise.withResolvers<void>();
  const seen: { late?: Promise<unknown> } = {};
  const Late = lateContextTask({ hold, root, scan: scans.promise, seen });
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
  const options = { conversationId: root.id, ownership: { kind: "conversation" } } as const;
  const lateId = yield* awaited(harness.commit((tx) => tx.createTask(Late, {}, options), context));
  expect((yield* awaited(harness.waitForTask(lateId, context))).state.outcome).toEqual(
    DONE.outcome,
  );
  const probeId = yield* awaited(
    harness.commit((tx) => tx.createTask(Probe, { name: "probe" }, options), context),
  );
  scans.resolve();
  yield* awaited(seen.late);
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

  const { harness, registry, root, scanned } = yield* countingSetup({
    settings: { contextRetentionMs: 50 },
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
  const options = { conversationId: root.id, ownership: { kind: "conversation" } } as const;
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
  const timeouts = vi.spyOn(AbortSignal, "timeout");
  yield* awaited(probe("first"));
  const scheduled = timeouts.mock.results.map((result) => result.value as AbortSignal);
  expect(scheduled.length).toBeGreaterThan(0);
  yield* Effect.sleep("100 millis");
  expect(scheduled.every((signal) => signal.aborted)).toBe(true);
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
  const options = { conversationId: root.id, ownership: { kind: "conversation" } } as const;
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
