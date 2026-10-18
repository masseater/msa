import type { Context } from "@msa/chord";
import { type Conversation, defineTask, type Storage, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";
import { completed } from "./task-support.ts";

export type Step = { phase: "run" };

function oneStepImpl(name: string, run: () => Promise<void> = () => Promise.resolve()) {
  return defineTask<null, Step, null>({
    name,
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(run());
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
}

export const oneStep: {
  (run?: () => Promise<void>): (name: string) => ReturnType<typeof oneStepImpl>;
  (name: string, run?: () => Promise<void>): ReturnType<typeof oneStepImpl>;
} = dual((args) => typeof args[0] === "string", oneStepImpl);

function startImpl(
  conversation: Conversation,
  task: ReturnType<typeof oneStep>,
  background = false,
): Promise<TaskId> {
  return conversation.commit(
    (tx) => tx.createTask(task, null, { ownership: { kind: "conversation" }, background }),
    context,
  );
}

export const start: {
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

export function withSignal(signal: AbortSignal): Context {
  return { ...context, abortSignal: signal };
}

export function storageOpen(storage: Storage): Promise<boolean> {
  return Promise.resolve(
    storage.task(1 as TaskId, context).then(
      () => true,
      () => false,
    ),
  );
}
