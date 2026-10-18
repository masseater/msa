import { createModels, type Message } from "@msa/ai";
import type { Context } from "@msa/chord";
import {
  type ContextView,
  defineTask,
  type EntryDraft,
  type EntryRecord,
  type HarnessSettings,
  type Storage,
  type TaskRuntime,
} from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import { addTask, assistant, openHarness, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

export const setup = Effect.fn("setup")(function* () {
  const { harness } = yield* openHarness(new MemoryStorage());
  const root = yield* awaited(harness.root(context));
  const append = (draft: EntryDraft): Promise<EntryRecord> =>
    root.commit((tx) => tx.appendEntry(root.id, draft), context);
  const message = (model: Message, kind = "message"): Promise<EntryRecord> =>
    append({ kind, model: [model] });
  return { harness, root, append, message };
});

export const countingSetup = Effect.fn("countingSetup")(function* (
  options: { readonly settings?: HarnessSettings; readonly now?: () => number } = {},
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const scanned = { rows: 0 };
  const hold: { scan?: Promise<void> | undefined } = {};
  const memory = new MemoryStorage();
  const storage = new Proxy<Storage>(memory, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (key === "scanEntries") {
        return (...args: Parameters<Storage["scanEntries"]>) =>
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
  return { harness, registry, root, first, scanned, hold };
});

export type Counting = Effect.Success<ReturnType<typeof countingSetup>>;

export type RunRuntime = TaskRuntime<Record<string, never>, { phase: "run" }, null, object>;

export const runInRoot = Effect.fn("runInRoot")(function* (
  { harness, registry, root }: Pick<Counting, "harness" | "registry" | "root">,
  name: string,
  run: (runtime: RunRuntime, taskContext: Context) => Promise<void>,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Run = defineTask<Record<string, never>, { phase: "run" }, null>({
    name,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: (_task, runtime, taskContext) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(run(runtime, taskContext));
            yield* awaited(runtime.commit(() => DONE, taskContext));
          }),
        ),
    },
    abort: (_task, runtime, taskContext) =>
      runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => ABORTED, taskContext)))),
      ),
  });
  addTask(registry, Run);
  harness.resume();
  const id = yield* awaited(
    harness.commit(
      (tx) =>
        tx.createTask(Run, {}, { ownership: { kind: "conversation" }, conversationId: root.id }),
      context,
    ),
  );
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual(DONE.outcome);
});

export const DONE = { status: "terminal", outcome: { status: "completed", result: null } } as const;

export const ABORTED = { status: "terminal", outcome: { status: "aborted" } } as const;

export function probeTask(
  read: (name: string, load: () => Promise<ContextView>, taskContext: Context) => Promise<void>,
) {
  return defineTask<{ name: string }, { phase: "run" }, null>({
    name: "test.context-probe",
    version: 1,
    initial: () => ({ phase: "run" }),
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
    abort: (_task, runtime, taskContext) =>
      Effect.runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => ABORTED, taskContext)))),
      ),
  });
}
