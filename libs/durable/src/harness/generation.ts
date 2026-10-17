import { Effect } from "effect";

import { defineTask } from "../tasks.ts";
import { abortGeneration } from "./generation-abort.ts";
import { pollPhase, retryPhase, toolsPhase } from "./generation-phases.ts";
import { preparePhase } from "./generation-prepare.ts";
import { requestPhase } from "./generation-request.ts";
import type {
  GenerationCheckpoint,
  GenerationInput,
  GenerationResult,
} from "./generation-types.ts";
import type { GenerationHooks } from "./types.ts";

export type {
  GenerationCheckpoint,
  GenerationInput,
  GenerationResult,
} from "./generation-types.ts";
export { convertPartial, handOver, startRun } from "./generation-run.ts";

export const GenerationTask = defineTask<
  GenerationInput,
  GenerationCheckpoint,
  GenerationResult,
  GenerationHooks
>({
  name: "msa.generation",
  version: 1,
  initial: () => ({ phase: "prepare", attempt: 1 }),
  phases: {
    prepare: (task, runtime, context) => Effect.runPromise(preparePhase(task, runtime, context)),
    request: (task, runtime, context) => Effect.runPromise(requestPhase(task, runtime, context)),
    retry: (task, runtime, context) => Effect.runPromise(retryPhase(task, runtime, context)),
    poll: (task, runtime, context) => Effect.runPromise(pollPhase(task, runtime, context)),
    tools: (task, runtime, context) => Effect.runPromise(toolsPhase(task, runtime, context)),
  },
  abort: (task, runtime, context) => Effect.runPromise(abortGeneration(task, runtime, context)),
});
