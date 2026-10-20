import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";

import type inboxTypes from "./inbox.types.ts";
import type liveTypes from "./live.types.ts";
import type typesModule from "./types.types.ts";
import type usageTypes from "./usage.types.ts";
import type viewTypesModule from "./view-types.ts";

declare namespace eventsTypesModule {
  type Views = {
    readonly before: viewTypesModule.ConversationView;
    readonly after: viewTypesModule.ConversationView;
  };

  type Block = aiTypes.AssistantMessage["content"][number];

  type QueuedItem = { id: typesModule.SubmissionId; mode: inboxTypes.InboxItem["mode"] };

  type EventConversationId = typesModule.ConversationId;

  type MessageChange =
    | {
        type: "text_start" | "thinking_start" | "toolcall_start";
        contentIndex: number;
        block: Block;
      }
    | { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string }
    | {
        type: "toolcall_delta";
        contentIndex: number;
        path: readonly (string | number)[];
        delta: string;
      }
    | { type: "block"; contentIndex: number; block: Block }
    | { type: "message"; message: aiTypes.AssistantMessage };

  type SnapshotEvent = {
    type: "snapshot";
    entries: readonly typesModule.EntryRecord[];
    run?: { inputs: readonly typesModule.SubmissionId[] };
    generation?: {
      attempt: number;
      message?: aiTypes.AssistantMessage;
      retry?: { at: number; error: string };
      deferred?: { pollAt: number };
    };
    tools: readonly liveTypes.ToolSlot[];
    nestedTools: readonly liveTypes.NestedToolSlot[];
    compactions: readonly liveTypes.CompactionStatus[];
    compactionFailure?: liveTypes.CompactionFailure;
    inbox: readonly QueuedItem[];
    agent: typesModule.AgentState;
    usage: usageTypes.UsageState;
  };

  type AgentEvent =
    | SnapshotEvent
    | { type: "run_start"; inputs: readonly typesModule.SubmissionId[] }
    | { type: "run_end"; inputs: readonly typesModule.SubmissionId[] }
    | { type: "turn_start" }
    | { type: "turn_end" }
    | { type: "message_start"; message: aiTypes.Message }
    | { type: "message_update"; usage: aiTypes.Usage; changes: readonly MessageChange[] }
    | { type: "message_end"; entry: typesModule.EntryRecord }
    | ({ type: "tool_execution_start"; args: typesModule.JsonObject } & ToolEventCall)
    | ({
        type: "tool_execution_update";
        output?: { trimStart?: number; append?: string } | { set: string };
        details?: chordTypes.JsonValue;
        diagnostics?: readonly typesModule.ToolDiagnostic[];
      } & ToolEventCall)
    | ({
        type: "tool_execution_end";
        entry?: typesModule.EntryRecord;
        result?: typesModule.NestedToolExecutionResult;
      } & ToolEventCall)
    | { type: "inbox_update"; items: readonly QueuedItem[] }
    | { type: "submission"; record: typesModule.SubmissionRecord }
    | { type: "auto_retry_start"; attempt: number; at: number; errorMessage: string }
    | { type: "auto_retry_end"; attempt: number }
    | { type: "deferred_poll"; pollAt: number }
    | { type: "entry_appended"; entry: typesModule.EntryRecord }
    | { type: "agent_changed"; agent: typesModule.AgentState }
    | { type: "usage_changed"; usage: usageTypes.UsageState }
    | { type: "task_failed"; taskId: typesModule.TaskId; kind: string; message: string }
    | {
        type: "compaction_start";
        taskId: typesModule.TaskId;
        reason: typesModule.CompactionReason;
        blocking: boolean;
      }
    | {
        type: "compaction_end";
        taskId: typesModule.TaskId;
        reason: typesModule.CompactionReason;
        error?: string;
      };

  type ToolEventCall = {
    toolCallId: string;
    toolName: string;
    taskId?: typesModule.TaskId;
    parentToolCallId?: string;
    parentTaskId?: typesModule.TaskId;
  };

  interface AgentEventStream {
    readonly snapshot: SnapshotEvent;
    start(
      listener: (events: readonly AgentEvent[], context: chordTypes.Context) => Promise<void>,
    ): void;
    stop(): Promise<typesModule.WatchEnd>;
    readonly closed: Promise<typesModule.WatchEnd>;
  }
}

export type { eventsTypesModule as default };
