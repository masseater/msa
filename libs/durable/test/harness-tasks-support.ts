import type { Context } from "@msa/chord";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import type harnessTasksSupportTypes from "./harness-tasks-support.types.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { defineTask } = durable;
const { MemoryStorage } = memory;

const { awaited } = effectSupport;
const { context } = sessionSupport;
const { abortMarked, abortedWith, completed, openTasks } = taskSupport;

function oneStepImpl<R = null>(
  name: string,
  run: (
    task: { readonly id: durableTypes.TaskId<R> },
    runtime: harnessTasksSupportTypes.StepRuntime<R>,
    context: Context,
  ) => Promise<void>,
  abort: (runtime: harnessTasksSupportTypes.StepRuntime<R>, context: Context) => Promise<void> = (
    runtime,
    ctx,
  ) => runtime.commit(() => abortedWith("test"), ctx),
): durableTypes.Task<null, harnessTasksSupportTypes.Step, R, object> {
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
      task: { readonly id: durableTypes.TaskId<R> },
      runtime: harnessTasksSupportTypes.StepRuntime<R>,
      context: Context,
    ) => Promise<void>,
    abort?: (runtime: harnessTasksSupportTypes.StepRuntime<R>, context: Context) => Promise<void>,
  ): (name: string) => durableTypes.Task<null, harnessTasksSupportTypes.Step, R, object>;
  <R = null>(
    name: string,
    run: (
      task: { readonly id: durableTypes.TaskId<R> },
      runtime: harnessTasksSupportTypes.StepRuntime<R>,
      context: Context,
    ) => Promise<void>,
    abort?: (runtime: harnessTasksSupportTypes.StepRuntime<R>, context: Context) => Promise<void>,
  ): durableTypes.Task<null, harnessTasksSupportTypes.Step, R, object>;
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
  conversation: durableTypes.Conversation,
  task: ReturnType<typeof oneStep<R>>,
  options: { readonly background?: boolean } = {},
): Promise<durableTypes.TaskId<R>> {
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
  ): (conversation: durableTypes.Conversation) => Promise<durableTypes.TaskId<R>>;
  <R>(
    conversation: durableTypes.Conversation,
    task: ReturnType<typeof oneStep<R>>,
    options?: { readonly background?: boolean },
  ): Promise<durableTypes.TaskId<R>>;
} = dual((args) => !("definition" in args[0]), startImpl);

const openRoot = Effect.fn("openRoot")(function* (
  tasks: Parameters<typeof openTasks>[1],
  options: Parameters<typeof openTasks>[2] & {
    readonly storage?: harnessTasksSupportTypes.MemoryStorage;
  } = {},
) {
  const opened = yield* openTasks(options.storage ?? new MemoryStorage(), tasks, options);
  const root = yield* awaited(opened.harness.root(context));
  return { ...opened, root };
});

const markDurably = Effect.fn("markDurably")(function* (
  harness: Effect.Success<ReturnType<typeof openRoot>>["harness"],
  id: durableTypes.TaskId,
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
