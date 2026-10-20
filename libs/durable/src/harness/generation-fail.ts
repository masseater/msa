import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import bridge from "./bridge.ts";
import type generationTypesModule from "./generation-types.types.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";

const { commitTask } = bridge;
const { LiveDoc, endRun } = liveModule;

const failModelError: typesModule.Dual3<
  generationTypesModule.GenerationRuntime,
  string,
  chordTypes.Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    runtime: generationTypesModule.GenerationRuntime,
    text: string,
    context: chordTypes.Context,
  ) {
    yield* commitTask(
      runtime,
      (tx) =>
        Effect.gen(function* () {
          const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
          endRun(tx, live, runtime.taskId, {
            detail: text,
            reason: "model_error",
            status: "unanswered",
          });
          return {
            outcome: {
              error: { detail: { reason: "model_error" }, message: text },
              status: "failed",
            },
            status: "terminal",
          };
        }),
      context,
    );
  }),
);

const failNoModel: typesModule.Dual3<
  generationTypesModule.GenerationRuntime,
  typesModule.ModelRef | undefined,
  chordTypes.Context,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    runtime: generationTypesModule.GenerationRuntime,
    ref: typesModule.ModelRef | undefined,
    context: chordTypes.Context,
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
          endRun(tx, live, runtime.taskId, { reason: "no_model", status: "unanswered" });
          return {
            outcome: { error: { detail: { reason: "no_model" }, message }, status: "failed" },
            status: "terminal",
          };
        }),
      context,
    );
  }),
);

const generationFail = {
  failModelError,
  failNoModel,
};

export default generationFail;
