import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { commitRequest, waitForBlockingCompaction } from "./generation-commit.ts";
import { failModelError, failNoModel } from "./generation-fail.ts";
import { planPrompt } from "./generation-plan.ts";
import { compactedFailure } from "./generation-threshold.ts";
import type {
  GenerationCheckpoint,
  GenerationInput,
  GenerationResult,
  GenerationRuntime,
} from "./generation-types.ts";
import type { RunningTask } from "./types.ts";

type PrepareTask = RunningTask<
  GenerationInput,
  Extract<GenerationCheckpoint, { phase: "prepare" }>,
  GenerationResult
>;

export const preparePhase = Effect.fnUntraced(function* (
  task: PrepareTask,
  runtime: GenerationRuntime,
  context: Context,
) {
  const agent = yield* Effect.promise(() => runtime.agent(context));
  const { model, thinkingLevel } = agent;
  const resolved =
    model === undefined ? undefined : runtime.models.getModel(model.provider, model.modelId);
  if (model === undefined || resolved === undefined)
    return yield* failNoModel(runtime, model, context);
  const checkpoint = task.state.checkpoint;
  const failure = yield* compactedFailure(runtime, checkpoint, context);
  if (failure !== undefined) return yield* failModelError(runtime, failure, context);
  const { attempt, compacted } = checkpoint;
  const plan = yield* planPrompt(
    runtime,
    agent,
    compacted !== undefined,
    resolved.contextWindow,
    context,
  );
  if (plan.threshold === "blocking")
    return yield* waitForBlockingCompaction(runtime, attempt, context);
  const request = {
    attempt,
    ...(compacted === undefined ? {} : { compacted }),
    model,
    thinkingLevel,
    streamOptions: runtime.settings.stream,
  };
  yield* commitRequest(runtime, plan.entries, request, plan.threshold, context);
});
