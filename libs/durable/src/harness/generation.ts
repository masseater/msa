import { Effect } from "effect";

import tasks from "../tasks.ts";
import generationAbort from "./generation-abort.ts";
import generationPhases from "./generation-phases.ts";
import generationPrepare from "./generation-prepare.ts";
import generationRequest from "./generation-request.ts";
import generationRun from "./generation-run.ts";
import type generationTypesModule from "./generation-types.types.ts";
import type typesModule from "./types.types.ts";

const { defineTask } = tasks;
const GenerationTask = defineTask<
  generationTypesModule.GenerationInput,
  generationTypesModule.GenerationCheckpoint,
  generationTypesModule.GenerationResult,
  typesModule.GenerationHooks
>({
  abort: (task, runtime, context) =>
    Effect.runPromise(generationAbort.abortGeneration(task, runtime, context)),
  initial: () => ({ attempt: 1, phase: "prepare" }),
  name: "msa.generation",
  phases: {
    poll: (task, runtime, context) =>
      Effect.runPromise(generationPhases.pollPhase(task, runtime, context)),
    prepare: (task, runtime, context) =>
      Effect.runPromise(generationPrepare.preparePhase(task, runtime, context)),
    request: (task, runtime, context) =>
      Effect.runPromise(generationRequest.requestPhase(task, runtime, context)),
    retry: (task, runtime, context) =>
      Effect.runPromise(generationPhases.retryPhase(task, runtime, context)),
    tools: (task, runtime, context) =>
      Effect.runPromise(generationPhases.toolsPhase(task, runtime, context)),
  },
  version: 1,
});

const generation = {
  GenerationTask,
  get convertPartial() {
    return generationRun.convertPartial;
  },
  get handOver() {
    return generationRun.handOver;
  },
  get startRun() {
    return generationRun.startRun;
  },
};

export default generation;
