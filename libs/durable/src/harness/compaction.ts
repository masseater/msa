import { Effect } from "effect";

import tasks from "../tasks.ts";
import compactionPlace from "./compaction-place.ts";
import compactionPrompt from "./compaction-prompt.ts";
import compactionSelect from "./compaction-select.ts";
import compactionSettle from "./compaction-settle.ts";
import compactionStart from "./compaction-start.ts";
import compactionSummarize from "./compaction-summarize.ts";
import type compactionTypesModule from "./compaction-types.ts";
import type typesModule from "./types.types.ts";

const { defineTask } = tasks;
const CompactionTask = defineTask<
  compactionTypesModule.CompactionInput,
  compactionTypesModule.CompactionCheckpoint,
  typesModule.CompactionResult,
  typesModule.CompactionHooks
>({
  abort: (_task, runtime, context) =>
    Effect.runPromise(compactionPlace.abortCompaction(runtime, context)),
  initial: () => ({ phase: "select" }),
  name: "msa.compaction",
  phases: {
    retry: (task, runtime, context) =>
      Effect.runPromise(
        compactionSettle.retryPhase(runtime, withoutPhase(task.state.checkpoint), context),
      ),
    select: (task, runtime, context) =>
      Effect.runPromise(compactionStart.selectPhase(runtime, task.input, context)),
    summarize: (task, runtime, context) =>
      Effect.runPromise(
        compactionSummarize.summarizePhase(
          runtime,
          withoutPhase(task.state.checkpoint),
          task.input,
          context,
        ),
      ),
  },
  version: 1,
});

const withoutPhase = <T extends { readonly phase: string }>({
  phase: _phase,
  ...rest
}: T): Omit<T, "phase"> => rest;

const compaction = {
  CompactionTask,
  get createCompaction() {
    return compactionStart.createCompaction;
  },
  estimateContext: compactionSelect.estimateContext,
  selectCut: compactionSelect.selectCut,
  serializeConversation: compactionPrompt.serializeConversation,
  summarizedMessages: compactionSelect.summarizedMessages,
};

export default compaction;
