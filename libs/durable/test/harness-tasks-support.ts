import type { Context } from "@msa/chord";
import {
  type Conversation,
  defineTask,
  type Task,
  type TaskId,
  type TaskRuntime,
} from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";
import { abortMarked, abortedWith, completed, openTasks } from "./task-support.ts";

export type Step = { phase: "run" };

export type StepRuntime<R> = TaskRuntime<null, Step, R, object>;

function oneStepImpl<R = null>(
  name: string,
  run: (
    task: { readonly id: TaskId<R> },
    runtime: StepRuntime<R>,
    context: Context,
  ) => Promise<void>,
  abort: (runtime: StepRuntime<R>, context: Context) => Promise<void> = (runtime, ctx) =>
    runtime.commit(() => abortedWith("test"), ctx),
): Task<null, Step, R, object> {
  return defineTask<null, Step, R>({
    name,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: { run: (task, runtime, ctx) => run(task, runtime, ctx) },
    abort: (_task, runtime, ctx) => abort(runtime, ctx),
  });
}

export const oneStep: {
  <R = null>(
    run: (
      task: { readonly id: TaskId<R> },
      runtime: StepRuntime<R>,
      context: Context,
    ) => Promise<void>,
    abort?: (runtime: StepRuntime<R>, context: Context) => Promise<void>,
  ): (name: string) => Task<null, Step, R, object>;
  <R = null>(
    name: string,
    run: (
      task: { readonly id: TaskId<R> },
      runtime: StepRuntime<R>,
      context: Context,
    ) => Promise<void>,
    abort?: (runtime: StepRuntime<R>, context: Context) => Promise<void>,
  ): Task<null, Step, R, object>;
} = dual((args) => typeof args[0] === "string", oneStepImpl);

function gatedImpl(name: string, gate: Promise<void>) {
  return oneStep(name, (_task, runtime, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* awaited(gate);
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
}

export const gated: {
  (gate: Promise<void>): (name: string) => ReturnType<typeof gatedImpl>;
  (name: string, gate: Promise<void>): ReturnType<typeof gatedImpl>;
} = dual(2, gatedImpl);

function startImpl<R>(
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

export const start: {
  <R>(
    task: ReturnType<typeof oneStep<R>>,
    options?: { readonly background?: boolean },
  ): (conversation: Conversation) => Promise<TaskId<R>>;
  <R>(
    conversation: Conversation,
    task: ReturnType<typeof oneStep<R>>,
    options?: { readonly background?: boolean },
  ): Promise<TaskId<R>>;
} = dual((args) => !("definition" in args[0]), startImpl);

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
