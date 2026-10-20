import type { AssistantMessage, Usage } from "@msa/ai";
import type { JsonRepresentation, JsonValue } from "@msa/chord";

import type typesModule from "./types.types.ts";

declare namespace liveTypes {
  type SlotProgress = {
    callId: string;
    name: string;
    status: "pending" | "running" | "done";
    output?: string;
    droppedBytes?: number;
    droppedLines?: number;
    details?: JsonValue;
    diagnostics?: typesModule.ToolDiagnostic[];
  };

  type ToolSlot = SlotProgress & {
    taskId?: typesModule.TaskId;
    entry?: typesModule.EntryId;
  };

  type NestedToolSlot = SlotProgress & {
    parentCallId: string;
    parentTaskId: typesModule.TaskId;
    taskId: typesModule.TaskId;
    arguments: typesModule.JsonObject;
    summary?: NestedToolSummary;
  };

  type NestedToolSummary = {
    isError: boolean;
    durationMs?: number;
    usage?: JsonRepresentation<Usage>;
    error?: string;
  };

  type CompactionStatus = {
    taskId: typesModule.TaskId<typesModule.CompactionResult>;
    reason: typesModule.CompactionReason;
    blocking: boolean;
    attempt: number;
    retry?: { at: number; error: string };
  };

  type CompactionFailure = {
    taskId: typesModule.TaskId<typesModule.CompactionResult>;
    reason: typesModule.CompactionReason;
    error: string;
  };

  type LiveState = {
    run?: { taskId: typesModule.TaskId; inputs: typesModule.SubmissionId[] };
    generation?: {
      attempt: number;
      message?: JsonRepresentation<AssistantMessage>;
      retry?: { at: number; error: string };
      deferred?: { pollAt: number };
    };
    tools?: ToolSlot[];
    nestedTools?: NestedToolSlot[];
    compactions?: CompactionStatus[];
    compactionFailure?: CompactionFailure;
  };
}

export type { liveTypes as default };
