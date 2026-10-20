import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import compaction from "./compaction.ts";
import type generationThresholdTypes from "./generation-threshold.types.ts";
import type generationTypesModule from "./generation-types.types.ts";
import type typesModule from "./types.types.ts";

const thresholdCompaction: typesModule.Dual4<
  typesModule.ContextView,
  readonly { readonly model?: readonly aiTypes.Message[] }[],
  number,
  typesModule.CompactionPolicy,
  generationThresholdTypes.ThresholdOutcome
> = Function.dual(
  4,
  (
    view: typesModule.ContextView,
    planned: readonly { readonly model?: readonly aiTypes.Message[] }[],
    contextWindow: number,
    policy: typesModule.CompactionPolicy,
  ): generationThresholdTypes.ThresholdOutcome => {
    if (!policy.enabled || contextWindow <= 0) return undefined;
    const tokens = compaction.estimateContext(
      view,
      planned.flatMap((entry) => entry.model ?? []),
    );
    const blocking = contextWindow - policy.reserveTokens;
    const background = blocking - policy.backgroundTokens;
    const over =
      tokens > blocking
        ? "blocking"
        : policy.backgroundTokens > 0 && tokens > background
          ? "background"
          : undefined;
    if (over === undefined || compaction.selectCut(view, policy.keepRecentTokens) === undefined)
      return undefined;
    return over;
  },
);

const compactionFailure = (
  outcome: Exclude<typesModule.TaskOutcome<typesModule.CompactionResult>, { status: "completed" }>,
): string => {
  switch (outcome.status) {
    case "failed":
    case "faulted":
      return `Compaction failed: ${outcome.error.message}`;
    case "orphaned":
      return `Compaction failed: ${outcome.reason}`;
    case "aborted":
      return "Compaction was aborted";
  }
};

const compactedFailure = Effect.fnUntraced(function* (
  runtime: generationTypesModule.GenerationRuntime,
  checkpoint: Extract<generationTypesModule.GenerationCheckpoint, { phase: "prepare" }>,
  context: chordTypes.Context,
) {
  const { compacted, overflow, threshold } = checkpoint;
  if (compacted === undefined) return undefined;
  const [outcome] = yield* Effect.promise(() => runtime.outcomes([compacted], context));
  if (
    overflow !== undefined &&
    (outcome?.status !== "completed" || outcome.result.entryId === undefined)
  )
    return overflow;
  if (threshold === true && outcome !== undefined && outcome.status !== "completed")
    return compactionFailure(outcome);
  return undefined;
});

const generationThreshold = {
  compactedFailure,
  thresholdCompaction,
};

export default generationThreshold;
