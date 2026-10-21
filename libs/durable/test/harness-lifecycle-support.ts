import type chordTypes from "@msa/chord/index.types";
import durable from "@msa/durable";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import type harnessLifecycleSupportTypes from "./harness-lifecycle-support.types.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { defineTask } = durable;

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
  conversation: durableTypes.Conversation,
  task: ReturnType<typeof oneStep>,
  background = false,
): Promise<durableTypes.TaskId> {
  return conversation.commit(
    (tx) => tx.createTask(task, null, { background, ownership: { kind: "conversation" } }),
    context,
  );
}

const start: {
  (
    task: ReturnType<typeof oneStep>,
    background?: boolean,
  ): (conversation: durableTypes.Conversation) => ReturnType<typeof startImpl>;
  (
    conversation: durableTypes.Conversation,
    task: ReturnType<typeof oneStep>,
    background?: boolean,
  ): ReturnType<typeof startImpl>;
} = dual((args) => !("definition" in args[0]), startImpl);

function withSignal(signal: AbortSignal): chordTypes.Context {
  return { ...context, abortSignal: signal };
}

function storageOpen(storage: durableTypes.Storage): Promise<boolean> {
  return Promise.resolve(
    storage.task(1 as durableTypes.TaskId, context).then(
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
