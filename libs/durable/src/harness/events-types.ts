import type { AssistantMessage, Message, Usage } from "@msa/ai";
import type { Context, JsonValue } from "@msa/chord";

import type { InboxItem } from "./inbox.ts";
import type { CompactionFailure, CompactionStatus, NestedToolSlot, ToolSlot } from "./live.ts";
import type {
  AgentState,
  CompactionReason,
  ConversationId,
  EntryRecord,
  JsonObject,
  NestedToolExecutionResult,
  SubmissionId,
  SubmissionRecord,
  TaskId,
  ToolDiagnostic,
  WatchEnd,
} from "./types.ts";
import type { UsageState } from "./usage.ts";
import type { ConversationView } from "./view-types.ts";

export type Views = { readonly before: ConversationView; readonly after: ConversationView };

export type Block = AssistantMessage["content"][number];
export type QueuedItem = { id: SubmissionId; mode: InboxItem["mode"] };
export type EventConversationId = ConversationId;

export type MessageChange =
  | { type: "text_start" | "thinking_start" | "toolcall_start"; contentIndex: number; block: Block }
  | { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string }
  | {
      type: "toolcall_delta";
      contentIndex: number;
      path: readonly (string | number)[];
      delta: string;
    }
  | { type: "block"; contentIndex: number; block: Block }
  | { type: "message"; message: AssistantMessage };

export type SnapshotEvent = {
  type: "snapshot";
  entries: readonly EntryRecord[];
  run?: { inputs: readonly SubmissionId[] };
  generation?: {
    attempt: number;
    message?: AssistantMessage;
    retry?: { at: number; error: string };
    deferred?: { pollAt: number };
  };
  tools: readonly ToolSlot[];
  nestedTools: readonly NestedToolSlot[];
  compactions: readonly CompactionStatus[];
  compactionFailure?: CompactionFailure;
  inbox: readonly QueuedItem[];
  agent: AgentState;
  usage: UsageState;
};

export type AgentEvent =
  | SnapshotEvent
  | { type: "run_start"; inputs: readonly SubmissionId[] }
  | { type: "run_end"; inputs: readonly SubmissionId[] }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start"; message: Message }
  | { type: "message_update"; usage: Usage; changes: readonly MessageChange[] }
  | { type: "message_end"; entry: EntryRecord }
  | ({ type: "tool_execution_start"; args: JsonObject } & ToolEventCall)
  | ({
      type: "tool_execution_update";
      output?: { trimStart?: number; append?: string } | { set: string };
      details?: JsonValue;
      diagnostics?: readonly ToolDiagnostic[];
    } & ToolEventCall)
  | ({
      type: "tool_execution_end";
      entry?: EntryRecord;
      result?: NestedToolExecutionResult;
    } & ToolEventCall)
  | { type: "inbox_update"; items: readonly QueuedItem[] }
  | { type: "submission"; record: SubmissionRecord }
  | { type: "auto_retry_start"; attempt: number; at: number; errorMessage: string }
  | { type: "auto_retry_end"; attempt: number }
  | { type: "deferred_poll"; pollAt: number }
  | { type: "entry_appended"; entry: EntryRecord }
  | { type: "agent_changed"; agent: AgentState }
  | { type: "usage_changed"; usage: UsageState }
  | { type: "task_failed"; taskId: TaskId; kind: string; message: string }
  | { type: "compaction_start"; taskId: TaskId; reason: CompactionReason; blocking: boolean }
  | { type: "compaction_end"; taskId: TaskId; reason: CompactionReason; error?: string };

export type ToolEventCall = {
  toolCallId: string;
  toolName: string;
  taskId?: TaskId;
  parentToolCallId?: string;
  parentTaskId?: TaskId;
};

export interface AgentEventStream {
  readonly snapshot: SnapshotEvent;
  start(listener: (events: readonly AgentEvent[], context: Context) => Promise<void>): void;
  stop(): Promise<WatchEnd>;
  readonly closed: Promise<WatchEnd>;
}
