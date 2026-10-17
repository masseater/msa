import type { Context } from "@msa/chord";
import { expectTypeOf, it } from "vite-plus/test";

import type { TaskId } from "../src/index.ts";
import {
  type AnyTask,
  type CompactionResult,
  type Conversation,
  defineExtension,
  defineTask,
  type Extension,
  type Harness,
  type HookApi,
  type HooksOf,
  hook,
  type SettledTask,
  type SubmissionDraft,
  type TaskRuntime,
} from "../src/index.ts";

declare const callContext: Context;

// A task with narrowed input, several phases, and custom hooks.
type Hooks = {
  beforeStep(step: number, api: HookApi, context: Context): { readonly skip: boolean } | undefined;
};
type Checkpoint = { phase: "plan"; steps: number } | { phase: "run"; step: number };
const Stepper = defineTask<{ steps: number }, Checkpoint, { ran: number }, Hooks>({
  name: "test.stepper",
  version: 1,
  initial: (input) => ({ phase: "plan", steps: input.steps }),
  phases: {
    plan: async (task, runtime, context) => {
      expectTypeOf(task.state.checkpoint.steps).toEqualTypeOf<number>();
      expectTypeOf(task.input.steps).toEqualTypeOf<number>();
      await runtime.commit(
        () => ({ status: "running", checkpoint: { phase: "run", step: 0 } }),
        context,
      );
    },
    run: async (task, runtime, context) => {
      expectTypeOf(task.state.checkpoint.step).toEqualTypeOf<number>();
      await runtime.hooks.each("beforeStep", (handler) => {
        expectTypeOf(handler).toEqualTypeOf<Hooks["beforeStep"]>();
      });
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: { ran: 1 } } }),
        context,
      );
    },
  },
  abort: async () => {},
});

async function typedWaits(
  harness: Harness,
  conversation: Conversation,
  runtime: TaskRuntime<null, Checkpoint, null, Hooks>,
) {
  const id = await conversation.commit(
    (tx) => tx.createTask(Stepper, { steps: 2 }, { ownership: { kind: "conversation" } }),
    callContext,
  );
  expectTypeOf(id).toEqualTypeOf<TaskId<{ ran: number }>>();
  const settled = await harness.waitForTask(id, callContext);
  expectTypeOf(settled).toEqualTypeOf<SettledTask<{ ran: number }>>();
  if (settled.state.outcome.status === "completed") {
    expectTypeOf(settled.state.outcome.result).toEqualTypeOf<{ ran: number }>();
  }
  expectTypeOf(await runtime.waitForTask(id, callContext)).toEqualTypeOf<
    SettledTask<{ ran: number }>
  >();
  const compaction = await conversation.compact(undefined, callContext);
  expectTypeOf(compaction).toEqualTypeOf<TaskId<CompactionResult>>();
  expectTypeOf(await harness.waitForTask(compaction, callContext)).toEqualTypeOf<
    SettledTask<CompactionResult>
  >();
}

function submissionDraftFailures() {
  const inputWithModel: SubmissionDraft = {
    type: "input",
    content: "hi",
    // @ts-expect-error an input's entry has no model: its model message is the input's content
    entry: { kind: "note", model: [] },
  };
  // @ts-expect-error a write submission carries no content
  const writeWithContent: SubmissionDraft = {
    type: "write",
    entry: { kind: "note" },
    content: "hi",
  };
  const writeWhenBusy: SubmissionDraft = {
    type: "write",
    entry: { kind: "note" },
    // @ts-expect-error a write submission never generates, so it has no busy policy
    whenBusy: "steer",
  };
  void [inputWithModel, writeWithContent, writeWhenBusy];
}

function taskDefinitionFailures(conversation: Conversation) {
  // @ts-expect-error hook handlers are typed by the task's hooks
  const wrongHook = hook(Stepper, { beforeStep: (_step: string) => undefined });
  // @ts-expect-error hook names come from the task's hooks
  const unknownHook = hook(Stepper, { afterStep: () => undefined });
  const wrongInput = conversation.commit(
    // @ts-expect-error task input is typed by the definition
    (tx) => tx.createTask(Stepper, { steps: "two" }, { ownership: { kind: "conversation" } }),
    callContext,
  );
  const missingPhase = defineTask<null, Checkpoint, null>({
    name: "test.missing-phase",
    version: 1,
    initial: () => ({ phase: "plan", steps: 1 }),
    // @ts-expect-error the phase map is exhaustive
    phases: { plan: async () => {} },
    abort: async () => {},
  });
  void [wrongHook, unknownHook, wrongInput, missingPhase];
}

it("types submissions, task waits, compaction, and tasks erased into extensions", () => {
  const input = { type: "input", content: "hi", whenBusy: "steer" } satisfies SubmissionDraft;
  const write = { type: "write", entry: { kind: "note" } } satisfies SubmissionDraft;
  expectTypeOf(input.type).toEqualTypeOf<"input">();
  expectTypeOf(write.type).toEqualTypeOf<"write">();

  expectTypeOf<HooksOf<typeof Stepper>>().toEqualTypeOf<Hooks>();
  const registration = hook(Stepper, {
    beforeStep: (step) => (step > 1 ? { skip: true } : undefined),
  });
  // Erased into an extension, whatever its input, phases, and hooks.
  const erased: AnyTask = Stepper;
  const extension: Extension = defineExtension({
    name: "stepper",
    tasks: [Stepper],
    hooks: [registration],
  });
  void [erased, extension];

  expectTypeOf(typedWaits).toBeFunction();
  expectTypeOf(submissionDraftFailures).toBeFunction();
  expectTypeOf(taskDefinitionFailures).toBeFunction();
});
