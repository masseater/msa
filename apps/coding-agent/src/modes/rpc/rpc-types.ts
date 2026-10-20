import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type {
  PromptDisposition,
  QueuedInputDisposition,
  SessionStats,
} from "../../core/agent-session.ts";
import type { PromptMode } from "../../core/ask.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type { ContextBreakdown } from "../../core/context-breakdown.ts";
import type { ContextUsage } from "../../core/extensions/types.ts";
import type { SessionEntry, SessionTreeNode } from "../../core/session-manager.ts";
import type { SourceInfo } from "../../core/source-info.ts";

export type RpcCommand =
  | {
      id?: string | undefined;
      type: "prompt";
      message: string;
      images?: aiTypes.ImageContent[] | undefined;
      streamingBehavior?: "steer" | "followUp" | undefined;

      mode?: PromptMode | undefined;
    }
  | {
      id?: string | undefined;
      type: "steer";
      message: string;
      images?: aiTypes.ImageContent[] | undefined;
    }
  | {
      id?: string | undefined;
      type: "follow_up";
      message: string;
      images?: aiTypes.ImageContent[] | undefined;
    }
  | { id?: string | undefined; type: "abort" }
  | { id?: string | undefined; type: "clear_queue" }
  | { id?: string | undefined; type: "new_session"; parentSession?: string | undefined }
  | { id?: string | undefined; type: "get_state" }
  | { id?: string | undefined; type: "set_model"; provider: string; modelId: string }
  | { id?: string | undefined; type: "cycle_model" }
  | { id?: string | undefined; type: "get_available_models" }
  | { id?: string | undefined; type: "set_thinking_level"; level: agentTypes.ThinkingLevel }
  | { id?: string | undefined; type: "cycle_thinking_level" }
  | { id?: string | undefined; type: "get_available_thinking_levels" }
  | { id?: string | undefined; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
  | { id?: string | undefined; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
  | { id?: string | undefined; type: "compact"; customInstructions?: string | undefined }
  | { id?: string | undefined; type: "set_auto_compaction"; enabled: boolean }
  | { id?: string | undefined; type: "set_auto_retry"; enabled: boolean }
  | { id?: string | undefined; type: "abort_retry" }
  | {
      id?: string | undefined;
      type: "bash";
      command: string;
      excludeFromContext?: boolean | undefined;
    }
  | { id?: string | undefined; type: "abort_bash" }
  | { id?: string | undefined; type: "get_session_stats" }
  | { id?: string | undefined; type: "export_html"; outputPath?: string | undefined }
  | { id?: string | undefined; type: "switch_session"; sessionPath: string }
  | { id?: string | undefined; type: "fork"; entryId: string }
  | { id?: string | undefined; type: "clone" }
  | { id?: string | undefined; type: "get_fork_messages" }
  | { id?: string | undefined; type: "get_entries"; since?: string | undefined }
  | { id?: string | undefined; type: "get_tree" }
  | { id?: string | undefined; type: "get_last_assistant_text" }
  | { id?: string | undefined; type: "set_session_name"; name: string }
  | { id?: string | undefined; type: "get_messages" }
  | { id?: string | undefined; type: "get_commands" };

export interface RpcSlashCommand {
  name: string;
  description?: string | undefined;
  source: "extension" | "prompt" | "skill";
  sourceInfo: SourceInfo;
}

export interface RpcSessionState {
  model?: aiTypes.Model<any> | undefined;
  thinkingLevel: agentTypes.ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  sessionFile?: string | undefined;
  sessionId: string;
  sessionName?: string | undefined;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;

  contextUsage?: (ContextUsage & { breakdown: ContextBreakdown }) | undefined;
}

export type RpcResponse =
  | {
      id?: string | undefined;
      type: "response";
      command: "prompt";
      success: true;
      data: { disposition: PromptDisposition };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "steer";
      success: true;
      data: { disposition: QueuedInputDisposition };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "follow_up";
      success: true;
      data: { disposition: QueuedInputDisposition };
    }
  | { id?: string | undefined; type: "response"; command: "abort"; success: true }
  | {
      id?: string | undefined;
      type: "response";
      command: "clear_queue";
      success: true;
      data: { steering: string[]; followUp: string[] };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "new_session";
      success: true;
      data: { cancelled: boolean };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_state";
      success: true;
      data: RpcSessionState;
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "set_model";
      success: true;
      data: aiTypes.Model<any>;
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "cycle_model";
      success: true;
      data: {
        model: aiTypes.Model<any>;
        thinkingLevel: agentTypes.ThinkingLevel;
        isScoped: boolean;
      } | null;
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_available_models";
      success: true;
      data: { models: aiTypes.Model<any>[] };
    }
  | { id?: string | undefined; type: "response"; command: "set_thinking_level"; success: true }
  | {
      id?: string | undefined;
      type: "response";
      command: "cycle_thinking_level";
      success: true;
      data: { level: agentTypes.ThinkingLevel } | null;
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_available_thinking_levels";
      success: true;
      data: { levels: agentTypes.ThinkingLevel[] };
    }
  | { id?: string | undefined; type: "response"; command: "set_steering_mode"; success: true }
  | { id?: string | undefined; type: "response"; command: "set_follow_up_mode"; success: true }
  | {
      id?: string | undefined;
      type: "response";
      command: "compact";
      success: true;
      data: CompactionResult;
    }
  | { id?: string | undefined; type: "response"; command: "set_auto_compaction"; success: true }
  | { id?: string | undefined; type: "response"; command: "set_auto_retry"; success: true }
  | { id?: string | undefined; type: "response"; command: "abort_retry"; success: true }
  | { id?: string | undefined; type: "response"; command: "bash"; success: true; data: BashResult }
  | { id?: string | undefined; type: "response"; command: "abort_bash"; success: true }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_session_stats";
      success: true;
      data: SessionStats;
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "export_html";
      success: true;
      data: { path: string };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "switch_session";
      success: true;
      data: { cancelled: boolean };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "fork";
      success: true;
      data: { text: string; cancelled: boolean };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "clone";
      success: true;
      data: { cancelled: boolean };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_fork_messages";
      success: true;
      data: { messages: Array<{ entryId: string; text: string }> };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_entries";
      success: true;
      data: { entries: SessionEntry[]; leafId: string | null };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_tree";
      success: true;
      data: { tree: SessionTreeNode[]; leafId: string | null };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_last_assistant_text";
      success: true;
      data: { text: string | null };
    }
  | { id?: string | undefined; type: "response"; command: "set_session_name"; success: true }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_messages";
      success: true;
      data: { messages: agentTypes.AgentMessage[] };
    }
  | {
      id?: string | undefined;
      type: "response";
      command: "get_commands";
      success: true;
      data: { commands: RpcSlashCommand[] };
    }
  | { id?: string | undefined; type: "response"; command: string; success: false; error: string };

export type RpcExtensionUIRequest =
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number | undefined;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number | undefined;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input";
      title: string;
      placeholder?: string | undefined;
      timeout?: number | undefined;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "editor";
      title: string;
      prefill?: string | undefined;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error" | undefined;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setStatus";
      statusKey: string;
      statusText: string | undefined;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines: string[] | undefined;
      widgetPlacement?: "aboveEditor" | "belowEditor" | undefined;
    }
  | { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
  | { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

export type RpcExtensionUIResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

export type RpcCommandType = RpcCommand["type"];
