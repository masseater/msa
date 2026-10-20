import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import type askTypes from "../../core/ask.types.ts";
import type bashExecutorTypes from "../../core/bash-executor.types.ts";
import type compactionTypes from "../../core/compaction/index.types.ts";
import type contextBreakdownTypes from "../../core/context-breakdown.types.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type sessionManagerTypes from "../../core/session-manager.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";

declare namespace rpcTypesTypes {
  type RpcCommand =
    | {
        id?: string | undefined;
        type: "prompt";
        message: string;
        images?: aiTypes.ImageContent[] | undefined;
        streamingBehavior?: "steer" | "followUp" | undefined;

        mode?: askTypes.PromptMode | undefined;
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

  interface RpcSlashCommand {
    name: string;
    description?: string | undefined;
    source: "extension" | "prompt" | "skill";
    sourceInfo: sourceInfoTypes.SourceInfo;
  }

  interface RpcSessionState {
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

    contextUsage?:
      | (extensionsTypesTypes.ContextUsage & { breakdown: contextBreakdownTypes.ContextBreakdown })
      | undefined;
  }

  type RpcResponse =
    | {
        id?: string | undefined;
        type: "response";
        command: "prompt";
        success: true;
        data: { disposition: agentSessionTypes.PromptDisposition };
      }
    | {
        id?: string | undefined;
        type: "response";
        command: "steer";
        success: true;
        data: { disposition: agentSessionTypes.QueuedInputDisposition };
      }
    | {
        id?: string | undefined;
        type: "response";
        command: "follow_up";
        success: true;
        data: { disposition: agentSessionTypes.QueuedInputDisposition };
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
        data: compactionTypes.CompactionResult;
      }
    | { id?: string | undefined; type: "response"; command: "set_auto_compaction"; success: true }
    | { id?: string | undefined; type: "response"; command: "set_auto_retry"; success: true }
    | { id?: string | undefined; type: "response"; command: "abort_retry"; success: true }
    | {
        id?: string | undefined;
        type: "response";
        command: "bash";
        success: true;
        data: bashExecutorTypes.BashResult;
      }
    | { id?: string | undefined; type: "response"; command: "abort_bash"; success: true }
    | {
        id?: string | undefined;
        type: "response";
        command: "get_session_stats";
        success: true;
        data: agentSessionTypes.SessionStats;
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
        data: { entries: sessionManagerTypes.SessionEntry[]; leafId: string | null };
      }
    | {
        id?: string | undefined;
        type: "response";
        command: "get_tree";
        success: true;
        data: { tree: sessionManagerTypes.SessionTreeNode[]; leafId: string | null };
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

  type RpcExtensionUIRequest =
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

  type RpcExtensionUIResponse =
    | { type: "extension_ui_response"; id: string; value: string }
    | { type: "extension_ui_response"; id: string; confirmed: boolean }
    | { type: "extension_ui_response"; id: string; cancelled: true };

  type RpcCommandType = RpcCommand["type"];
}

export type { rpcTypesTypes as default };
