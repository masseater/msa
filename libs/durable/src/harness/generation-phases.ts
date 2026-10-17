import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { commitTask } from "./bridge.ts";
import { classify } from "./generation-classify.ts";
import { failNoModel } from "./generation-fail.ts";
import { finishToolRound } from "./generation-finish.ts";
import { createToolTask } from "./generation-tools.ts";
import type {
  GenerationCheckpoint,
  GenerationNext,
  GenerationRuntime,
  PhaseTask,
} from "./generation-types.ts";
import { LiveDoc } from "./live.ts";
import type { Tx } from "./types.ts";

export const retryPhase = Effect.fn("retryPhase")(function* (
  task: PhaseTask<"retry">,
  runtime: GenerationRuntime,
  context: Context,
) {
  const { attempt, compacted, until } = task.state.checkpoint;
  yield* Effect.promise(() => runtime.sleep(until, context));
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        live.generation = { attempt: attempt + 1 };
        return {
          status: "running",
          checkpoint: {
            phase: "prepare",
            attempt: attempt + 1,
            ...(compacted === undefined ? {} : { compacted }),
          },
        };
      }),
    context,
  );
});

export const pollPhase = Effect.fn("pollPhase")(function* (
  task: PhaseTask<"poll">,
  runtime: GenerationRuntime,
  context: Context,
) {
  const { attempt, compacted, model: ref, cutoff, handle, pollAt } = task.state.checkpoint;
  const model = runtime.models.getModel(ref.provider, ref.modelId);
  if (model === undefined) return yield* failNoModel(runtime, ref, context);
  yield* Effect.promise(() => runtime.sleep(pollAt, context));
  const message = yield* Effect.promise(() =>
    runtime.models.fetchDeferred(model, handle, { signal: runtime.signal }),
  );
  yield* classify(runtime, { attempt, compacted, model: ref, cutoff, pollAt }, message, context);
});

export const toolsPhase = Effect.fn("toolsPhase")(function* (
  task: PhaseTask<"tools">,
  runtime: GenerationRuntime,
  context: Context,
) {
  const { assistant, tools, pending } = task.state.checkpoint;
  const [next, ...rest] = pending;
  if (next === undefined) return yield* finishToolRound(runtime, assistant, tools, context);
  yield* commitTask(
    runtime,
    (tx: Tx): Effect.Effect<GenerationNext> =>
      Effect.gen(function* () {
        const live = yield* Effect.promise(() => tx.doc(LiveDoc, runtime.conversationId));
        const taskId = yield* createToolTask(tx, runtime, assistant, next);
        const slot = live.tools?.find(
          (candidate) => candidate.callId === next && candidate.taskId === undefined,
        );
        if (slot !== undefined) slot.taskId = taskId;
        const checkpoint: GenerationCheckpoint = {
          phase: "tools",
          assistant,
          tools: [...tools, taskId],
          pending: rest,
        };
        return { status: "waiting", checkpoint, on: [taskId], policy: "allSettled" };
      }),
    context,
  );
});
