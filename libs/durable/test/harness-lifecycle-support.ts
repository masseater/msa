import type { Context } from "@msa/chord";
import { type Conversation, defineTask, type Storage, type TaskId } from "@msa/durable";

import { context } from "./session-support.ts";
import { completed } from "./task-support.ts";

export type Step = { phase: "run" };

// A one-phase task running `run` and completing with null.
export function oneStep(name: string, run: () => Promise<void> = async () => {}) {
  return defineTask<null, Step, null>({
    name,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (_task, runtime, ctx) => {
        await run();
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async () => {},
  });
}

export function start(
  conversation: Conversation,
  task: ReturnType<typeof oneStep>,
  background = false,
): Promise<TaskId> {
  return conversation.commit(
    (tx) => tx.createTask(task, null, { ownership: { kind: "conversation" }, background }),
    context,
  );
}

export function withSignal(signal: AbortSignal): Context {
  return { ...context, abortSignal: signal };
}

// Whether a raw Storage read still succeeds, as code of a joined invocation relies on.
export function storageOpen(storage: Storage): Promise<boolean> {
  return Promise.resolve(
    storage.task(1 as TaskId, context).then(
      () => true,
      () => false,
    ),
  );
}
