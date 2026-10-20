import type { Context } from "@msa/chord";
import { Effect } from "effect";
import { expectTypeOf, it } from "vite-plus/test";

import type { TaskId } from "../src/index.ts";
import {
  type AnyTask,
  type CompactionResult,
  type Conversation,
  type Extension,
  type Harness,
  type HookApi,
  type HooksOf,
  type SettledTask,
  type SubmissionDraft,
  type TaskDefinition,
  type TaskRuntime,
  defineExtension,
  defineTask,
  hook,
} from "../src/index.ts";
import effectSupport from "./effect-support.ts";
import type typeSupportTypes from "./type-support.ts";

const { awaited } = effectSupport;

declare const callContext: Context;

type Hooks = {
  beforeStep(step: number, api: HookApi, context: Context): { readonly skip: boolean } | undefined;
};
type Checkpoint = { phase: "plan"; steps: number } | { phase: "run"; step: number };
const Stepper = defineTask<{ steps: number }, Checkpoint, { ran: number }, Hooks>({
  abort: () => Promise.resolve(),
  initial: (input) => ({ phase: "plan", steps: input.steps }),
  name: "test.stepper",
  phases: {
    plan: (task, runtime, context) =>
      Effect.runPromise(
        Effect.gen(function* () {
          expectTypeOf(task.state.checkpoint.steps).toEqualTypeOf<number>();
          expectTypeOf(task.input.steps).toEqualTypeOf<number>();
          yield* awaited(
            runtime.commit(
              () => ({ checkpoint: { phase: "run", step: 0 }, status: "running" }),
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
              () => ({ outcome: { result: { ran: 1 }, status: "completed" }, status: "terminal" }),
              context,
            ),
          );
        }),
      ),
  },
  version: 1,
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
    typeSupportTypes.LiteralFits<
      { type: "input"; content: "hi"; entry: { kind: "note"; model: [] } },
      SubmissionDraft
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ type: "input"; content: "hi"; entry: Note }, SubmissionDraft>
  >().toEqualTypeOf<true>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ type: "write"; entry: Note; content: "hi" }, SubmissionDraft>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ type: "write"; entry: Note; whenBusy: "steer" }, SubmissionDraft>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ type: "write"; entry: Note }, SubmissionDraft>
  >().toEqualTypeOf<true>();
}

function taskDefinitionFailures() {
  type StepperHooks = Partial<HooksOf<typeof Stepper>>;
  type StepperInput = Parameters<(typeof Stepper)["definition"]["initial"]>[0];
  type Phases = TaskDefinition<null, Checkpoint, null, object>["phases"];
  expectTypeOf<{ beforeStep: (step: string) => undefined }>().not.toExtend<StepperHooks>();
  expectTypeOf<{ beforeStep: (step: number) => undefined }>().toExtend<StepperHooks>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ afterStep: () => undefined }, StepperHooks>
  >().toEqualTypeOf<false>();
  expectTypeOf<{ steps: "two" }>().not.toExtend<StepperInput>();
  expectTypeOf<{ steps: 2 }>().toExtend<StepperInput>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ plan: () => Promise<void> }, Phases>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ plan: () => Promise<void>; run: () => Promise<void> }, Phases>
  >().toEqualTypeOf<true>();
}

it("types submissions, task waits, compaction, and tasks erased into extensions", () => {
  const input = { content: "hi", type: "input", whenBusy: "steer" } satisfies SubmissionDraft;
  const write = { entry: { kind: "note" }, type: "write" } satisfies SubmissionDraft;
  expectTypeOf(input.type).toEqualTypeOf<"input">();
  expectTypeOf(write.type).toEqualTypeOf<"write">();

  expectTypeOf<HooksOf<typeof Stepper>>().toEqualTypeOf<Hooks>();
  const registration = hook(Stepper, {
    beforeStep: (step) => (step > 1 ? { skip: true } : undefined),
  });
  const erased: AnyTask = Stepper;
  const extension: Extension = defineExtension({
    hooks: [registration],
    name: "stepper",
    tasks: [Stepper],
  });
  void [erased, extension];

  expectTypeOf(typedWaits).toBeFunction();
  expectTypeOf(submissionDraftFailures).toBeFunction();
  expectTypeOf(taskDefinitionFailures).toBeFunction();
});
