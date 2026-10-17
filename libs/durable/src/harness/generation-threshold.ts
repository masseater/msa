import type { Message } from "@msa/ai";
import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { estimateContext, selectCut } from "./compaction.ts";
import type { GenerationCheckpoint, GenerationRuntime } from "./generation-types.ts";
import type {
  CompactionPolicy,
  CompactionResult,
  ContextView,
  Dual4,
  TaskOutcome,
} from "./types.ts";

export type ThresholdOutcome = "blocking" | "background" | undefined;

export const thresholdCompaction: Dual4<
  ContextView,
  readonly { readonly model?: readonly Message[] }[],
  number,
  CompactionPolicy,
  ThresholdOutcome
> = Function.dual(
  4,
  (
    view: ContextView,
    planned: readonly { readonly model?: readonly Message[] }[],
    contextWindow: number,
    policy: CompactionPolicy,
  ): ThresholdOutcome => {
    if (!policy.enabled || contextWindow <= 0) return undefined;
    const tokens = estimateContext(
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
    if (over === undefined || selectCut(view, policy.keepRecentTokens) === undefined)
      return undefined;
    return over;
  },
);

const compactionFailure = (
  outcome: Exclude<TaskOutcome<CompactionResult>, { status: "completed" }>,
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

export const compactedFailure = Effect.fnUntraced(function* (
  runtime: GenerationRuntime,
  checkpoint: Extract<GenerationCheckpoint, { phase: "prepare" }>,
  context: Context,
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
