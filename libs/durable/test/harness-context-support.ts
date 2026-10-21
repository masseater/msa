import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import memoryModule from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import harnessContextSupportKit from "./harness-context-support-kit.ts";
import type harnessContextSupportTypes from "./harness-context-support.types.ts";
import sessionSupport from "./session-support.ts";

const { effectSupport, harnessSupport } = harnessContextSupportKit;

const { createModels } = ai;

const { MemoryStorage } = memoryModule;
const { Harness, createRegistry } = harnessModule;
const { defineTask } = durable;

const { awaited } = effectSupport;
const { addTask, assistant, openHarness, user } = harnessSupport;
const { context } = sessionSupport;

const setup = Effect.fn("setup")(function* () {
  const { harness } = yield* openHarness(new MemoryStorage());
  const root = yield* awaited(harness.root(context));
  const append = (
    draft: harnessContextSupportTypes.EntryDraft,
  ): Promise<harnessContextSupportTypes.EntryRecord> =>
    root.commit((tx) => tx.appendEntry(root.id, draft), context);
  const message = (
    model: aiTypes.Message,
    kind = "message",
  ): Promise<harnessContextSupportTypes.EntryRecord> => append({ kind, model: [model] });
  return { append, harness, message, root };
});

const countingSetupStep = () =>
  Effect.gen(function* () {
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const scanned = { rows: 0 };
    const hold: { scan?: Promise<void> | undefined } = {};
    const memory = new MemoryStorage();
    const storage = new Proxy<harnessContextSupportTypes.Storage>(memory, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (key === "scanEntries") {
          return (...args: Parameters<harnessContextSupportTypes.Storage["scanEntries"]>) =>
            runPromise(
              Effect.gen(function* () {
                const held = args[1] > 1 ? hold.scan : undefined;
                if (held !== undefined) hold.scan = undefined;
                yield* awaited(held);
                const page = yield* awaited(target.scanEntries(...args));
                scanned.rows += page.items.length;
                return page;
              }),
            );
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { hold, scanned, storage };
  });

const countingSetup = Effect.fn("countingSetup")(function* (
  options: {
    readonly settings?: harnessContextSupportTypes.HarnessSettings;
    readonly now?: () => number;
  } = {},
) {
  const { hold, scanned, storage } = yield* countingSetupStep();
  const registry = createRegistry();
  const harness = yield* awaited(
    Harness.open(storage, { models: createModels(), registry, ...options }, context),
  );
  const root = yield* awaited(harness.root(context));
  const first = yield* awaited(
    root.commit(
      (tx) => tx.appendEntry(root.id, { kind: "message", model: [user("first")] }),
      context,
    ),
  );
  for (const index of Array.from({ length: 20 }, (_, i) => i)) {
    yield* awaited(
      root.commit(
        (tx) => tx.appendEntry(root.id, { kind: "message", model: [assistant(`old ${index}`)] }),
        context,
      ),
    );
  }
  return { first, harness, hold, registry, root, scanned };
});

const runInRoot = Effect.fn("runInRoot")(function* (
  { harness, registry, root }: harnessContextSupportTypes.RootHandles,
  name: string,
  run: (
    runtime: harnessContextSupportTypes.RunRuntime,
    taskContext: harnessContextSupportTypes.Context,
  ) => Promise<void>,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Run = defineTask<Record<string, never>, { phase: "run" }, null>({
    abort: (_task, runtime, taskContext) =>
      runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => ABORTED, taskContext)))),
      ),
    initial: () => ({ phase: "run" }),
    name,
    phases: {
      run: (_task, runtime, taskContext) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(run(runtime, taskContext));
            yield* awaited(runtime.commit(() => DONE, taskContext));
          }),
        ),
    },
    version: 1,
  });
  addTask(registry, Run);
  harness.resume();
  const id = yield* awaited(
    harness.commit(
      (tx) =>
        tx.createTask(Run, {}, { conversationId: root.id, ownership: { kind: "conversation" } }),
      context,
    ),
  );
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual(DONE.outcome);
});

const DONE = { outcome: { result: null, status: "completed" }, status: "terminal" } as const;

const ABORTED = { outcome: { status: "aborted" }, status: "terminal" } as const;

function probeTask(
  read: (
    name: string,
    load: () => Promise<harnessContextSupportTypes.ContextView>,
    taskContext: harnessContextSupportTypes.Context,
  ) => Promise<void>,
) {
  return defineTask<{ name: string }, { phase: "run" }, null>({
    abort: (_task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => ABORTED, taskContext)))),
      ),
    initial: () => ({ phase: "run" }),
    name: "test.context-probe",
    phases: {
      run: (task, runtime, taskContext) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(
              read(
                task.input.name,
                () => runtime.context(runtime.conversationId, taskContext),
                taskContext,
              ),
            );
            yield* awaited(runtime.commit(() => DONE, taskContext));
          }),
        ),
    },
    version: 1,
  });
}

const harnessContextSupport = {
  ABORTED,
  DONE,
  countingSetup,
  probeTask,
  runInRoot,
  setup,
};

export default harnessContextSupport;
