import type { Context } from "@msa/chord";
import { type Conversation, type Storage, type TaskId, defineTask } from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import type harnessLifecycleSupportTypes from "./harness-lifecycle-support.types.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { context } = sessionSupport;
const { completed } = taskSupport;

function oneStepImpl(name: string, run: () => Promise<void> = () => Promise.resolve()) {
  return defineTask<null, harnessLifecycleSupportTypes.Step, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "run" }),
    name,
    phases: {
      run: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(run());
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    version: 1,
  });
}

const oneStep: {
  (run?: () => Promise<void>): (name: string) => ReturnType<typeof oneStepImpl>;
  (name: string, run?: () => Promise<void>): ReturnType<typeof oneStepImpl>;
} = dual((args) => typeof args[0] === "string", oneStepImpl);

function startImpl(
  conversation: Conversation,
  task: ReturnType<typeof oneStep>,
  background = false,
): Promise<TaskId> {
  return conversation.commit(
    (tx) => tx.createTask(task, null, { background, ownership: { kind: "conversation" } }),
    context,
  );
}

const start: {
  (
    task: ReturnType<typeof oneStep>,
    background?: boolean,
  ): (conversation: Conversation) => ReturnType<typeof startImpl>;
  (
    conversation: Conversation,
    task: ReturnType<typeof oneStep>,
    background?: boolean,
  ): ReturnType<typeof startImpl>;
} = dual((args) => !("definition" in args[0]), startImpl);

function withSignal(signal: AbortSignal): Context {
  return { ...context, abortSignal: signal };
}

function storageOpen(storage: Storage): Promise<boolean> {
  return Promise.resolve(
    storage.task(1 as TaskId, context).then(
      () => true,
      () => false,
    ),
  );
}

const harnessLifecycleSupport = {
  oneStep,
  start,
  storageOpen,
  withSignal,
};

export default harnessLifecycleSupport;
