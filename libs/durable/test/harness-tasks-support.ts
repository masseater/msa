import type { Context } from "@msa/chord";
import { type Conversation, type Task, type TaskId, defineTask } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import type harnessTasksSupportTypes from "./harness-tasks-support.types.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { context } = sessionSupport;
const { abortMarked, abortedWith, completed, openTasks } = taskSupport;

function oneStepImpl<R = null>(
  name: string,
  run: (
    task: { readonly id: TaskId<R> },
    runtime: harnessTasksSupportTypes.StepRuntime<R>,
    context: Context,
  ) => Promise<void>,
  abort: (runtime: harnessTasksSupportTypes.StepRuntime<R>, context: Context) => Promise<void> = (
    runtime,
    ctx,
  ) => runtime.commit(() => abortedWith("test"), ctx),
): Task<null, harnessTasksSupportTypes.Step, R, object> {
  return defineTask<null, harnessTasksSupportTypes.Step, R>({
    abort: (_task, runtime, ctx) => abort(runtime, ctx),
    initial: () => ({ phase: "run" }),
    name,
    phases: { run: (task, runtime, ctx) => run(task, runtime, ctx) },
    version: 1,
  });
}

const oneStep: {
  <R = null>(
    run: (
      task: { readonly id: TaskId<R> },
      runtime: harnessTasksSupportTypes.StepRuntime<R>,
      context: Context,
    ) => Promise<void>,
    abort?: (runtime: harnessTasksSupportTypes.StepRuntime<R>, context: Context) => Promise<void>,
  ): (name: string) => Task<null, harnessTasksSupportTypes.Step, R, object>;
  <R = null>(
    name: string,
    run: (
      task: { readonly id: TaskId<R> },
      runtime: harnessTasksSupportTypes.StepRuntime<R>,
      context: Context,
    ) => Promise<void>,
    abort?: (runtime: harnessTasksSupportTypes.StepRuntime<R>, context: Context) => Promise<void>,
  ): Task<null, harnessTasksSupportTypes.Step, R, object>;
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

const gated: {
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

const start: {
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

const openRoot = Effect.fn("openRoot")(function* (
  tasks: Parameters<typeof openTasks>[1],
  options: Parameters<typeof openTasks>[2] & { readonly storage?: MemoryStorage } = {},
) {
  const opened = yield* openTasks(options.storage ?? new MemoryStorage(), tasks, options);
  const root = yield* awaited(opened.harness.root(context));
  return { ...opened, root };
});

const markDurably = Effect.fn("markDurably")(function* (
  harness: Effect.Success<ReturnType<typeof openRoot>>["harness"],
  id: TaskId,
) {
  const aborting = harness.abortTask(id, context);
  yield* abortMarked(harness, id);
  return { aborting };
});

function withSignal(signal: AbortSignal): Context {
  return { ...context, abortSignal: signal };
}

const harnessTasksSupport = {
  gated,
  markDurably,
  oneStep,
  openRoot,
  start,
  withSignal,
};

export default harnessTasksSupport;
