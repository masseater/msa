import type { Context } from "@msa/chord";
import { Effect } from "effect";

import bridge from "./bridge.ts";
import generationClassify from "./generation-classify.ts";
import generationFail from "./generation-fail.ts";
import generationFinish from "./generation-finish.ts";
import generationTools from "./generation-tools.ts";
import type generationTypesModule from "./generation-types.types.ts";
import liveModule from "./live.ts";
import type typesModule from "./types.types.ts";

const { commitTask } = bridge;
const { LiveDoc } = liveModule;
const { failNoModel } = generationFail;
const retryPhase = Effect.fnUntraced(function* (
  task: generationTypesModule.PhaseTask<"retry">,
  runtime: generationTypesModule.GenerationRuntime,
  context: Context,
) {
  const { attempt, compacted, until } = task.state.checkpoint;
  yield* Effect.promise(() => runtime.sleep(until, context));
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        live.generation = { attempt: attempt + 1 };
        return {
          checkpoint: {
            attempt: attempt + 1,
            phase: "prepare",
            ...(compacted === undefined ? {} : { compacted }),
          },
          status: "running",
        };
      }),
    context,
  );
});

const pollPhase = Effect.fnUntraced(function* (
  task: generationTypesModule.PhaseTask<"poll">,
  runtime: generationTypesModule.GenerationRuntime,
  context: Context,
) {
  const { attempt, compacted, model: ref, cutoff, handle, pollAt } = task.state.checkpoint;
  const model = runtime.models.getModel(ref.provider, ref.modelId);
  if (model === undefined) return yield* failNoModel(runtime, ref, context);
  yield* Effect.promise(() => runtime.sleep(pollAt, context));
  const message = yield* Effect.promise(() =>
    runtime.models.fetchDeferred(model, handle, { signal: runtime.signal }),
  );
  yield* generationClassify.classify(
    runtime,
    { attempt, compacted, cutoff, model: ref, pollAt },
    message,
    context,
  );
});

const toolsPhase = Effect.fnUntraced(function* (
  task: generationTypesModule.PhaseTask<"tools">,
  runtime: generationTypesModule.GenerationRuntime,
  context: Context,
) {
  const { assistant, tools, pending } = task.state.checkpoint;
  const [next, ...rest] = pending;
  if (next === undefined)
    return yield* generationFinish.finishToolRound(runtime, assistant, tools, context);
  yield* commitTask(
    runtime,
    (tx: typesModule.Tx): Effect.Effect<generationTypesModule.GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        const taskId = yield* generationTools.createToolTask(tx, runtime, assistant, next);
        const slot = live.tools?.find(
          (candidate) => candidate.callId === next && candidate.taskId === undefined,
        );
        if (slot !== undefined) slot.taskId = taskId;
        const checkpoint: generationTypesModule.GenerationCheckpoint = {
          assistant,
          pending: rest,
          phase: "tools",
          tools: [...tools, taskId],
        };
        return { checkpoint, on: [taskId], policy: "allSettled", status: "waiting" };
      }),
    context,
  );
});

const generationPhases = {
  pollPhase,
  retryPhase,
  toolsPhase,
};

export default generationPhases;
