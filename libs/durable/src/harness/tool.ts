import { Effect } from "effect";

import tasks from "../tasks.ts";
import toolPhases from "./tool-phases.ts";
import toolResult from "./tool-result.ts";
import toolTypesModule2 from "./tool-types.ts";
import type toolTypesModule from "./tool-types.types.ts";
import type typesModule from "./types.types.ts";

const { defineTask } = tasks;
const ToolTask: typesModule.Task<
  toolTypesModule.ToolTaskInput,
  toolTypesModule.ToolTaskCheckpoint,
  toolTypesModule.ToolTaskResult,
  typesModule.ToolHooks
> = defineTask<
  toolTypesModule.ToolTaskInput,
  toolTypesModule.ToolTaskCheckpoint,
  toolTypesModule.ToolTaskResult,
  typesModule.ToolHooks
>({
  abort: (task, runtime, context) =>
    Effect.runPromise(toolPhases.abortPhase(task, runtime, context)),
  initial: () => ({ phase: "call" }),
  migrate: (input, checkpoint) => ({
    checkpoint: checkpoint as toolTypesModule.ToolTaskCheckpoint,
    input: { kind: "model", ...(input as { assistant: typesModule.EntryId; callId: string }) },
  }),
  name: "msa.tool",
  phases: {
    call: (task, runtime, context) =>
      Effect.runPromise(toolPhases.callPhase(task, runtime, context)),
    execute: (task, runtime, context) =>
      Effect.runPromise(toolPhases.executePhase(task, runtime, context)),
  },
  version: 2,
});

const tool = {
  NestedCallDoc: toolTypesModule2.NestedCallDoc,
  ToolTask,
  appendToolResult: toolResult.appendToolResult,
  harnessError: toolResult.harnessError,
};

export default tool;
