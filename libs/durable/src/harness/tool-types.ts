import type { ImageContent, TextContent, ToolCall } from "@msa/ai";
import type { JsonRepresentation, JsonValue } from "@msa/chord";
import type { OutputBuffer, OutputLimits } from "@msa/chord/output";

import { defineDocFamily } from "../documents.ts";
import type {
  EntryId,
  JsonObject,
  NestedToolExecutionResult,
  TaskId,
  TaskRuntime,
  ToolControl,
  ToolDiagnostic,
  ToolHooks,
} from "./types.ts";

export type ToolTaskInput =
  | { kind: "model"; assistant: EntryId; callId: string }
  | {
      kind: "nested";
      parent: TaskId;
      parentCallId: string;
      key: string;
      call: ToolCall;
      progress?: false;
    };

export type ToolTaskCheckpoint =
  | { phase: "call" }
  | { phase: "execute"; arguments: JsonObject; replay: "safe" | "unsafe" };

export type ToolTaskResult =
  | { kind: "model"; entryId: EntryId; control?: ToolControl }
  | { kind: "nested" };

export const MADE_NESTED_CALLS = "msa.tool.madeNestedCalls";

export const TOOL_TASK_NAME = "msa.tool";

export type NestedCallState = {
  taskId?: TaskId<ToolTaskResult>;
  result?: JsonRepresentation<NestedToolExecutionResult>;
};

export const NestedCallDoc = defineDocFamily<NestedCallState, null>({
  kind: "msa.tool.nested-call",
  version: 1,
  scope: "task",
  family: true,
  initial: () => ({}),
});

export type ToolRuntime = TaskRuntime<ToolTaskInput, ToolTaskCheckpoint, ToolTaskResult, ToolHooks>;

export type Content = (TextContent | ImageContent)[];

export type Reported = {
  readonly output: OutputBuffer;
  readonly limits: OutputLimits;
  readonly diagnostics: ToolDiagnostic[];
  details: JsonValue | undefined;
};

export type Ending =
  | { readonly status: "completed" | "aborted" }
  | { readonly status: "failed"; readonly message: string };

export const COMPLETED: Ending = { status: "completed" };
