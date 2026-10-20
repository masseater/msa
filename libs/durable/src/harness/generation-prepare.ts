import type { Context } from "@msa/chord";
import { Effect } from "effect";

import generationCommit from "./generation-commit.ts";
import generationFail from "./generation-fail.ts";
import generationPlan from "./generation-plan.ts";
import generationThreshold from "./generation-threshold.ts";
import type generationTypesModule from "./generation-types.types.ts";
import type typesModule from "./types.types.ts";

const { failModelError, failNoModel } = generationFail;
type PrepareTask = typesModule.RunningTask<
  generationTypesModule.GenerationInput,
  Extract<generationTypesModule.GenerationCheckpoint, { phase: "prepare" }>,
  generationTypesModule.GenerationResult
>;

const preparePhase = Effect.fnUntraced(function* (
  task: PrepareTask,
  runtime: generationTypesModule.GenerationRuntime,
  context: Context,
) {
  const agent = yield* Effect.promise(() => runtime.agent(context));
  const { model, thinkingLevel } = agent;
  const resolved =
    model === undefined ? undefined : runtime.models.getModel(model.provider, model.modelId);
  if (model === undefined || resolved === undefined)
    return yield* failNoModel(runtime, model, context);
  const checkpoint = task.state.checkpoint;
  const failure = yield* generationThreshold.compactedFailure(runtime, checkpoint, context);
  if (failure !== undefined) return yield* failModelError(runtime, failure, context);
  const { attempt, compacted } = checkpoint;
  const plan = yield* generationPlan.planPrompt(
    runtime,
    agent,
    compacted !== undefined,
    resolved.contextWindow,
    context,
  );
  if (plan.threshold === "blocking")
    return yield* generationCommit.waitForBlockingCompaction(runtime, attempt, context);
  const request = {
    attempt,
    ...(compacted === undefined ? {} : { compacted }),
    model,
    streamOptions: runtime.settings.stream,
    thinkingLevel,
  };
  yield* generationCommit.commitRequest(runtime, plan.entries, request, plan.threshold, context);
});

const generationPrepare = {
  preparePhase,
};

export default generationPrepare;
