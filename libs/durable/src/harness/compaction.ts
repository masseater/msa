import { Effect } from "effect";

import { defineTask } from "../tasks.ts";
import { abortCompaction } from "./compaction-place.ts";
import { retryPhase } from "./compaction-settle.ts";
import { selectPhase } from "./compaction-start.ts";
import { summarizePhase } from "./compaction-summarize.ts";
import type { CompactionCheckpoint, CompactionInput } from "./compaction-types.ts";
import type { CompactionHooks, CompactionResult } from "./types.ts";

export type { CompactionCheckpoint, CompactionInput, SummaryRequest } from "./compaction-types.ts";
export { estimateContext, selectCut, summarizedMessages } from "./compaction-select.ts";
export { serializeConversation } from "./compaction-prompt.ts";
export { createCompaction } from "./compaction-start.ts";

export const CompactionTask = defineTask<
  CompactionInput,
  CompactionCheckpoint,
  CompactionResult,
  CompactionHooks
>({
  name: "msa.compaction",
  version: 1,
  initial: () => ({ phase: "select" }),
  phases: {
    select: (task, runtime, context) =>
      Effect.runPromise(selectPhase(runtime, task.input, context)),
    summarize: (task, runtime, context) =>
      Effect.runPromise(
        summarizePhase(runtime, withoutPhase(task.state.checkpoint), task.input, context),
      ),
    retry: (task, runtime, context) =>
      Effect.runPromise(retryPhase(runtime, withoutPhase(task.state.checkpoint), context)),
  },
  abort: (_task, runtime, context) => Effect.runPromise(abortCompaction(runtime, context)),
});

const withoutPhase = <T extends { readonly phase: string }>({
  phase: _phase,
  ...rest
}: T): Omit<T, "phase"> => rest;
