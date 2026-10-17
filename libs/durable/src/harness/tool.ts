import { Effect } from "effect";

import { defineTask } from "../tasks.ts";
import { abortPhase, callPhase, executePhase } from "./tool-phases.ts";
import type { ToolTaskCheckpoint, ToolTaskInput, ToolTaskResult } from "./tool-types.ts";
import type { EntryId, Task, ToolHooks } from "./types.ts";

export { appendToolResult, harnessError } from "./tool-result.ts";
export { NestedCallDoc } from "./tool-types.ts";
export type {
  NestedCallState,
  ToolTaskCheckpoint,
  ToolTaskInput,
  ToolTaskResult,
} from "./tool-types.ts";

export const ToolTask: Task<ToolTaskInput, ToolTaskCheckpoint, ToolTaskResult, ToolHooks> =
  defineTask<ToolTaskInput, ToolTaskCheckpoint, ToolTaskResult, ToolHooks>({
    name: "msa.tool",
    version: 2,
    initial: () => ({ phase: "call" }),
    migrate: (input, checkpoint) => ({
      input: { kind: "model", ...(input as { assistant: EntryId; callId: string }) },
      checkpoint: checkpoint as ToolTaskCheckpoint,
    }),
    phases: {
      call: (task, runtime, context) => Effect.runPromise(callPhase(task, runtime, context)),
      execute: (task, runtime, context) => Effect.runPromise(executePhase(task, runtime, context)),
    },
    abort: (task, runtime, context) => Effect.runPromise(abortPhase(task, runtime, context)),
  });
