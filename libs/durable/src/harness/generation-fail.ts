import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { commitTask } from "./bridge.ts";
import type { GenerationRuntime } from "./generation-types.ts";
import { endRun, LiveDoc } from "./live.ts";
import type { Dual3, ModelRef } from "./types.ts";

export const failModelError: Dual3<
  GenerationRuntime,
  string,
  Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (runtime: GenerationRuntime, text: string, context: Context) {
    yield* commitTask(
      runtime,
      (tx) =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          endRun(tx, live, runtime.taskId, {
            status: "unanswered",
            reason: "model_error",
            detail: text,
          });
          return {
            status: "terminal",
            outcome: {
              status: "failed",
              error: { message: text, detail: { reason: "model_error" } },
            },
          };
        }),
      context,
    );
  }),
);

export const failNoModel: Dual3<
  GenerationRuntime,
  ModelRef | undefined,
  Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    runtime: GenerationRuntime,
    ref: ModelRef | undefined,
    context: Context,
  ) {
    const message =
      ref === undefined
        ? "No model is configured"
        : `Model ${ref.provider}/${ref.modelId} is not available`;
    yield* commitTask(
      runtime,
      (tx) =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          endRun(tx, live, runtime.taskId, { status: "unanswered", reason: "no_model" });
          return {
            status: "terminal",
            outcome: { status: "failed", error: { message, detail: { reason: "no_model" } } },
          };
        }),
      context,
    );
  }),
);
