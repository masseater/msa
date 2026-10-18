import { defineTask, type Id, type TaskId } from "@msa/durable";
import { Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";

import { ControlledStorage, context } from "./session-support.ts";
import { aborted, deferred, openTasks } from "./task-support.ts";

/** Waits for its signal, records that it saw it, and ends `aborted` through its abort handler. */
export const signals: string[] = [];

export const Waiting = defineTask<null, { phase: "work" }, null>({
  name: "test.waiting",
  version: 1,
  initial: () => ({ phase: "work" }),
  phases: {
    work: async (_task, runtime) => {
      await aborted(runtime.signal).catch(() => {});
      signals.push("aborted");
    },
  },
  abort: async (_task, runtime, abortContext) => {
    await runtime.commit(
      () => ({ status: "terminal", outcome: { status: "aborted" } }),
      abortContext,
    );
  },
});

/**
 * Fails each Storage method named in `failing` once, with `error`. A scan of entries with a limit above 1 is the context
 * read's scan of its range, off the Session line; `heldRange` holds it until released.
 */
export class FailingCalls extends ControlledStorage {
  readonly error = new Error("disk gone");
  readonly failing = new Set<string>();
  heldRange:
    | { readonly entered: ReturnType<typeof deferred<void>>; readonly release: Promise<unknown> }
    | undefined;
  #fail(method: string): void {
    if (this.failing.delete(method)) throw this.error;
  }
  override task(...args: Parameters<MemoryStorage["task"]>) {
    this.#fail("task");
    return Promise.resolve(super.task(...args));
  }
  override async scanEntries(...args: Parameters<MemoryStorage["scanEntries"]>) {
    if (args[1] > 1) {
      const held = this.heldRange;
      if (held !== undefined) {
        held.entered.resolve();
        await held.release;
      }
      this.#fail("scanRange");
    }
    return super.scanEntries(...args);
  }
  override mintId<I extends Id<string>>(): Promise<I> {
    this.#fail("mintId");
    return Promise.resolve(super.mintId<I>());
  }
}

export async function started(storage: MemoryStorage) {
  signals.length = 0;
  const opened = await openTasks(storage, [Waiting]);
  const root = await opened.harness.root(context);
  return { ...opened, root };
}

export async function running(harness: Harness, id: TaskId): Promise<void> {
  if ((await harness.getTask(id, context))?.state.status === "running") return;
  await new Promise((resolve) => {
    setTimeout(resolve, 1);
  });
  await running(harness, id);
}
