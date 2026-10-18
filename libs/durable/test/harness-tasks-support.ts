import type { Context } from "@msa/chord";
import { type Conversation, defineTask, type TaskId, type TaskRuntime } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";
import { abortMarked, abortedWith, completed, openTasks } from "./task-support.ts";

export type Step = { phase: "run" };

export type StepRuntime<R> = TaskRuntime<null, Step, R, object>;

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

export function gated(name: string, gate: Promise<void>) {
  return oneStep(name, (_task, runtime, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* awaited(gate);
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
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

export const openRoot = Effect.fn("openRoot")(function* (
  tasks: Parameters<typeof openTasks>[1],
  options: Parameters<typeof openTasks>[2] & { readonly storage?: MemoryStorage } = {},
) {
  const opened = yield* openTasks(options.storage ?? new MemoryStorage(), tasks, options);
  const root = yield* awaited(opened.harness.root(context));
  return { ...opened, root };
});

export const markDurably = Effect.fn("markDurably")(function* (
  harness: Effect.Success<ReturnType<typeof openRoot>>["harness"],
  id: TaskId,
) {
  const aborting = harness.abortTask(id, context);
  yield* abortMarked(harness, id);
  return { aborting };
});

export function withSignal(signal: AbortSignal): Context {
  return { ...context, abortSignal: signal };
}
