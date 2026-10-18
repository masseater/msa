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
import { expect } from "vite-plus/test";

import { addTask, assistant, openHarness, user } from "./harness-support.ts";
import { context } from "./session-support.ts";

export async function setup() {
  const { harness } = await openHarness(new MemoryStorage());
  const root = await harness.root(context);
  const append = (draft: EntryDraft): Promise<EntryRecord> =>
    root.commit((tx) => tx.appendEntry(root.id, draft), context);
  const message = (model: Message, kind = "message"): Promise<EntryRecord> =>
    append({ kind, model: [model] });
  return { harness, root, append, message };
}

// A Harness over MemoryStorage that counts scanned entry rows, with a 21-entry root transcript.
export async function countingSetup(
  options: { readonly settings?: HarnessSettings; readonly now?: () => number } = {},
) {
  const scanned = { rows: 0 };
  /** When set, the next range scan waits for it; bounds probes (one row, on the Session line) do not. */
  const hold: { scan?: Promise<void> | undefined } = {};
  const memory = new MemoryStorage();
  const storage = new Proxy<Storage>(memory, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (key === "scanEntries") {
        return async (...args: Parameters<Storage["scanEntries"]>) => {
          const held = args[1] > 1 ? hold.scan : undefined;
          if (held !== undefined) hold.scan = undefined;
          await held;
          const page = await target.scanEntries(...args);
          scanned.rows += page.items.length;
          return page;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const registry = createRegistry();
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry, ...options },
    context,
  );
  const root = await harness.root(context);
  const first = await root.commit(
    (tx) => tx.appendEntry(root.id, { kind: "message", model: [user("first")] }),
    context,
  );
  for await (const index of Array.from({ length: 20 }, (_, i) => i)) {
    await root.commit(
      (tx) => tx.appendEntry(root.id, { kind: "message", model: [assistant(`old ${index}`)] }),
      context,
    );
  }
  return { harness, registry, root, first, scanned, hold };
}

export type Counting = Awaited<ReturnType<typeof countingSetup>>;

export type RunRuntime = TaskRuntime<Record<string, never>, { phase: "run" }, null, object>;

// Run `run` as a one-phase task `name` in the root conversation, then expect it completed.
export async function runInRoot(
  { harness, registry, root }: Pick<Counting, "harness" | "registry" | "root">,
  name: string,
  run: (runtime: RunRuntime, taskContext: Context) => Promise<void>,
): Promise<void> {
  const Run = defineTask<Record<string, never>, { phase: "run" }, null>({
    name,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (_task, runtime, taskContext) => {
        await run(runtime, taskContext);
        await runtime.commit(() => DONE, taskContext);
      },
    },
    abort: async (_task, runtime, taskContext) => {
      await runtime.commit(() => ABORTED, taskContext);
    },
  });
  addTask(registry, Run);
  harness.resume();
  const id = await harness.commit(
    (tx) =>
      tx.createTask(Run, {}, { ownership: { kind: "conversation" }, conversationId: root.id }),
    context,
  );
  expect((await harness.waitForTask(id, context)).state.outcome).toEqual(DONE.outcome);
}

export const DONE = { status: "terminal", outcome: { status: "completed", result: null } } as const;

export const ABORTED = { status: "terminal", outcome: { status: "aborted" } } as const;

// A task that reads its conversation's context once, named by its input.
export function probeTask(
  read: (name: string, load: () => Promise<ContextView>, taskContext: Context) => Promise<void>,
) {
  return defineTask<{ name: string }, { phase: "run" }, null>({
    name: "test.context-probe",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (task, runtime, taskContext) => {
        await read(
          task.input.name,
          () => runtime.context(runtime.conversationId, taskContext),
          taskContext,
        );
        await runtime.commit(() => DONE, taskContext);
      },
    },
    abort: async (_task, runtime, taskContext) => {
      await runtime.commit(() => ABORTED, taskContext);
    },
  });
}
