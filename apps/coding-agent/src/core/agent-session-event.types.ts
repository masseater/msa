import type agentTypes from "@msa/agent-core/index.types";

import type compactionTypes from "./compaction/index.types.ts";
import type goalTypes from "./goal.types.ts";
import type serviceTypes from "./pr-watch/service.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

declare namespace agentSessionEventTypes {
  type WithParentToolCallId<E> = E extends {
    type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  }
    ? E & { parentToolCallId?: string }
    : E;

  type AgentSessionEvent =
    | WithParentToolCallId<Exclude<agentTypes.AgentEvent, { type: "agent_end" }>>
    | {
        type: "agent_end";
        messages: agentTypes.AgentMessage[];
        willRetry: boolean;
      }
    | { type: "agent_settled"; aborted: boolean }
    | {
        type: "queue_update";
        steering: readonly string[];
        followUp: readonly string[];
      }
    | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
    | { type: "entry_appended"; entry: sessionManagerTypes.SessionEntry }
    | { type: "session_info_changed"; name: string | undefined }
    | { type: "thinking_level_changed"; level: agentTypes.ThinkingLevel }
    | {
        type: "compaction_end";
        reason: "manual" | "threshold" | "overflow";
        result: compactionTypes.CompactionResult | undefined;
        aborted: boolean;
        willRetry: boolean;
        errorMessage?: string | undefined;
      }
    | {
        type: "auto_retry_start";
        attempt: number;
        maxAttempts: number;
        delayMs: number;
        errorMessage: string;
      }
    | {
        type: "auto_retry_end";
        success: boolean;
        attempt: number;
        finalError?: string | undefined;
      }
    | { type: "model_fallback"; from: string; to: string; errorMessage: string }
    | {
        type: "provider_stalled";
        at: number;
        model: string;
        errorMessage: string;
        reason: "auth" | "quota";
      }
    | { type: "provider_recovered"; since: number; model: string }
    | {
        type: "summarization_retry_scheduled";
        attempt: number;
        maxAttempts: number;
        delayMs: number;
        errorMessage: string;
      }
    | { type: "summarization_retry_attempt_start"; source: "branchSummary" }
    | {
        type: "summarization_retry_attempt_start";
        source: "compaction";
        reason: "manual" | "threshold" | "overflow";
      }
    | { type: "summarization_retry_finished" }
    | { type: "bash_execution_update"; id?: string | undefined; delta: string }
    | { type: "goal_changed"; goal: goalTypes.GoalSnapshot | undefined }
    | { type: "pr_watch_changed"; prWatch: serviceTypes.PrWatchSnapshot }
    | { type: "orchestrator_changed" }
    | { type: "goal_status"; goal: goalTypes.GoalSnapshot | undefined }
    | { type: "memory_status"; text: string };

  type AgentSessionEventListener = (event: AgentSessionEvent) => void;
}

export type { agentSessionEventTypes as default };
