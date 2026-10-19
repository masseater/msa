import type { Context } from "@msa/chord";
import { Effect } from "effect";
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
  type TaskDefinition,
  type TaskRuntime,
} from "../src/index.ts";
import { awaited } from "./effect-support.ts";
import type { LiteralFits } from "./type-support.ts";

declare const callContext: Context;

type Hooks = {
  beforeStep(step: number, api: HookApi, context: Context): { readonly skip: boolean } | undefined;
};
type Checkpoint = { phase: "plan"; steps: number } | { phase: "run"; step: number };
const Stepper = defineTask<{ steps: number }, Checkpoint, { ran: number }, Hooks>({
  name: "test.stepper",
  version: 1,
  initial: (input) => ({ phase: "plan", steps: input.steps }),
  phases: {
    plan: (task, runtime, context) =>
      Effect.runPromise(
        Effect.gen(function* () {
          expectTypeOf(task.state.checkpoint.steps).toEqualTypeOf<number>();
          expectTypeOf(task.input.steps).toEqualTypeOf<number>();
          yield* awaited(
            runtime.commit(
              () => ({ status: "running", checkpoint: { phase: "run", step: 0 } }),
              context,
            ),
          );
        }),
      ),
    run: (task, runtime, context) =>
      Effect.runPromise(
        Effect.gen(function* () {
          expectTypeOf(task.state.checkpoint.step).toEqualTypeOf<number>();
          yield* awaited(
            runtime.hooks.each("beforeStep", (handler) => {
              expectTypeOf(handler).toEqualTypeOf<Hooks["beforeStep"]>();
            }),
          );
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "completed", result: { ran: 1 } } }),
              context,
            ),
          );
        }),
      ),
  },
  abort: () => Promise.resolve(),
});

function typedWaits(
  harness: Harness,
  conversation: Conversation,
  runtime: TaskRuntime<null, Checkpoint, null, Hooks>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const id = yield* awaited(
        conversation.commit(
          (tx) => tx.createTask(Stepper, { steps: 2 }, { ownership: { kind: "conversation" } }),
          callContext,
        ),
      );
      expectTypeOf(id).toEqualTypeOf<TaskId<{ ran: number }>>();
      const settled = yield* awaited(harness.waitForTask(id, callContext));
      expectTypeOf(settled).toEqualTypeOf<SettledTask<{ ran: number }>>();
      if (settled.state.outcome.status === "completed") {
        expectTypeOf(settled.state.outcome.result).toEqualTypeOf<{ ran: number }>();
      }
      expectTypeOf(yield* awaited(runtime.waitForTask(id, callContext))).toEqualTypeOf<
        SettledTask<{ ran: number }>
      >();
      const compaction = yield* awaited(conversation.compact(undefined, callContext));
      expectTypeOf(compaction).toEqualTypeOf<TaskId<CompactionResult>>();
      expectTypeOf(yield* awaited(harness.waitForTask(compaction, callContext))).toEqualTypeOf<
        SettledTask<CompactionResult>
      >();
    }),
  );
}

function submissionDraftFailures() {
  type Note = { kind: "note" };
  expectTypeOf<
    LiteralFits<
      { type: "input"; content: "hi"; entry: { kind: "note"; model: [] } },
      SubmissionDraft
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<{ type: "input"; content: "hi"; entry: Note }, SubmissionDraft>
  >().toEqualTypeOf<true>();
  expectTypeOf<
    LiteralFits<{ type: "write"; entry: Note; content: "hi" }, SubmissionDraft>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<{ type: "write"; entry: Note; whenBusy: "steer" }, SubmissionDraft>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<{ type: "write"; entry: Note }, SubmissionDraft>
  >().toEqualTypeOf<true>();
}

function taskDefinitionFailures() {
  type StepperHooks = Partial<HooksOf<typeof Stepper>>;
  type StepperInput = Parameters<(typeof Stepper)["definition"]["initial"]>[0];
  type Phases = TaskDefinition<null, Checkpoint, null, object>["phases"];
  expectTypeOf<{ beforeStep: (step: string) => undefined }>().not.toExtend<StepperHooks>();
  expectTypeOf<{ beforeStep: (step: number) => undefined }>().toExtend<StepperHooks>();
  expectTypeOf<LiteralFits<{ afterStep: () => undefined }, StepperHooks>>().toEqualTypeOf<false>();
  expectTypeOf<{ steps: "two" }>().not.toExtend<StepperInput>();
  expectTypeOf<{ steps: 2 }>().toExtend<StepperInput>();
  expectTypeOf<LiteralFits<{ plan: () => Promise<void> }, Phases>>().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<{ plan: () => Promise<void>; run: () => Promise<void> }, Phases>
  >().toEqualTypeOf<true>();
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
