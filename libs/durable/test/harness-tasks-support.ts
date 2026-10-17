import type { Context } from "@msa/chord";
import {
  type Conversation,
  defineTask,
  MemoryStorage,
  type TaskId,
  type TaskRuntime,
} from "@msa/durable";

import { context } from "./session-support.ts";
import { abortMarked, abortedWith, completed, openTasks } from "./task-support.ts";

export type Step = { phase: "run" };

export type StepRuntime<R> = TaskRuntime<null, Step, R, object>;

// A one-phase task; the default abort handler settles `aborted` with reason "test".
export function oneStep<R = null>(
  name: string,
  run: (
    task: { readonly id: TaskId<R> },
    runtime: StepRuntime<R>,
    context: Context,
  ) => Promise<void>,
  abort: (runtime: StepRuntime<R>, context: Context) => Promise<void> = (runtime, ctx) =>
    runtime.commit(() => abortedWith("test"), ctx),
) {
  return defineTask<null, Step, R>({
    name,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: { run: (task, runtime, ctx) => run(task, runtime, ctx) },
    abort: (_task, runtime, ctx) => abort(runtime, ctx),
  });
}

// A one-phase task that waits for `gate` and completes with null.
export function gated(name: string, gate: Promise<void>) {
  return oneStep(name, async (_task, runtime, ctx) => {
    await gate;
    await runtime.commit(() => completed(null), ctx);
  });
}

export function start<R>(
  conversation: Conversation,
  task: ReturnType<typeof oneStep<R>>,
  options: { readonly background?: boolean } = {},
): Promise<TaskId<R>> {
  return Promise.resolve(
    conversation.commit(
      (tx) => tx.createTask(task, null, { ownership: { kind: "conversation" }, ...options }),
      context,
    ),
  );
}

export async function openRoot(
  tasks: Parameters<typeof openTasks>[1],
  options: Parameters<typeof openTasks>[2] & { readonly storage?: MemoryStorage } = {},
) {
  const opened = await openTasks(options.storage ?? new MemoryStorage(), tasks, options);
  const root = await opened.harness.root(context);
  return { ...opened, root };
}

// Start `abortTask()` and resolve once its mark is durable, before it has joined the run.
export async function markDurably(
  harness: Awaited<ReturnType<typeof openRoot>>["harness"],
  id: TaskId,
): Promise<{ readonly aborting: Promise<unknown> }> {
  const aborting = harness.abortTask(id, context);
  await abortMarked(harness, id);
  return { aborting };
}

export function withSignal(signal: AbortSignal): Context {
  return { ...context, abortSignal: signal };
}
