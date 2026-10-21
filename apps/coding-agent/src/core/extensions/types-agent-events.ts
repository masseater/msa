import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type editTypes from "../tools/edit.types.ts";
import type toolsTypes from "../tools/index.types.ts";
import type typesSessionEventsTypes from "./types-session-events.ts";

declare namespace typesAgentEventsTypes {
  interface TurnStartEvent {
    type: "turn_start";
    turnIndex: number;
    timestamp: number;
  }

  interface TurnEndEvent extends typesSessionEventsTypes.BoundaryState {
    type: "turn_end";
    turnIndex: number;
    message: agentTypes.AgentMessage;
    toolResults: aiTypes.ToolResultMessage[];
    messageEntryId: string;
    toolResultEntryIds: string[];
  }

  interface MessageStartEvent {
    type: "message_start";
    message: agentTypes.AgentMessage;
  }

  interface MessageUpdateEvent {
    type: "message_update";
    message: agentTypes.AgentMessage;
    assistantMessageEvent: aiTypes.AssistantMessageEvent;
  }

  interface MessageEndEvent {
    type: "message_end";
    message: agentTypes.AgentMessage;
  }

  interface ToolExecutionStartEvent {
    type: "tool_execution_start";
    toolCallId: string;
    toolName: string;
    args: any;
    parentToolCallId?: string;
  }

  interface ToolExecutionUpdateEvent {
    type: "tool_execution_update";
    toolCallId: string;
    toolName: string;
    args: any;
    partialResult: any;
    parentToolCallId?: string;
  }

  interface ToolExecutionEndEvent {
    type: "tool_execution_end";
    toolCallId: string;
    toolName: string;
    result: any;
    isError: boolean;
    durationMs?: number;
    parentToolCallId?: string;
  }

  type ModelSelectSource = "set" | "cycle" | "restore";

  interface ModelSelectEvent {
    type: "model_select";
    model: aiTypes.Model<any>;
    previousModel: aiTypes.Model<any> | undefined;
    source: ModelSelectSource;
  }

  interface ThinkingLevelSelectEvent {
    type: "thinking_level_select";
    level: agentTypes.ThinkingLevel;
    previousLevel: agentTypes.ThinkingLevel;
  }

  interface UserBashEvent {
    type: "user_bash";
    command: string;
    excludeFromContext: boolean;
    cwd: string;
  }

  type InputSource = "interactive" | "rpc" | "extension";

  interface InputEvent {
    type: "input";
    text: string;
    images?: aiTypes.ImageContent[] | undefined;
    source: InputSource;
    streamingBehavior?: "steer" | "followUp" | undefined;
  }

  type InputEventResult =
    | { action: "continue" }
    | { action: "transform"; text: string; images?: aiTypes.ImageContent[] | undefined }
    | { action: "handled" };

  interface ToolCallEventBase {
    type: "tool_call";
    toolCallId: string;
    parentToolCallId?: string;
  }

  interface BashToolCallEvent extends ToolCallEventBase {
    toolName: "bash";
    input: toolsTypes.BashToolInput;
  }

  interface PowerShellToolCallEvent extends ToolCallEventBase {
    toolName: "powershell";
    input: toolsTypes.PowerShellToolInput;
  }

  interface ReadToolCallEvent extends ToolCallEventBase {
    toolName: "read";
    input: toolsTypes.ReadToolInput;
  }

  interface EditToolCallEvent extends ToolCallEventBase {
    toolName: "edit";
    input: toolsTypes.EditToolInput;
  }

  interface WriteToolCallEvent extends ToolCallEventBase {
    toolName: "write";
    input: toolsTypes.WriteToolInput;
  }

  interface GrepToolCallEvent extends ToolCallEventBase {
    toolName: "grep";
    input: toolsTypes.GrepToolInput;
  }

  interface FindToolCallEvent extends ToolCallEventBase {
    toolName: "find";
    input: toolsTypes.FindToolInput;
  }

  interface LsToolCallEvent extends ToolCallEventBase {
    toolName: "ls";
    input: toolsTypes.LsToolInput;
  }

  interface CustomToolCallEvent extends ToolCallEventBase {
    toolName: string;
    input: Record<string, unknown>;
  }

  type ToolCallEvent =
    | BashToolCallEvent
    | PowerShellToolCallEvent
    | ReadToolCallEvent
    | EditToolCallEvent
    | WriteToolCallEvent
    | GrepToolCallEvent
    | FindToolCallEvent
    | LsToolCallEvent
    | CustomToolCallEvent;

  interface ToolResultEventBase {
    type: "tool_result";
    toolCallId: string;
    parentToolCallId?: string;
    input: Record<string, unknown>;
    content: (aiTypes.TextContent | aiTypes.ImageContent)[];
    structuredContent?: aiTypes.JsonValue;
    isError: boolean;
    usage?: aiTypes.Usage | undefined;
  }

  interface BashToolResultEvent extends ToolResultEventBase {
    toolName: "bash";
    details: toolsTypes.BashToolDetails | undefined;
  }

  interface PowerShellToolResultEvent extends ToolResultEventBase {
    toolName: "powershell";
    details: toolsTypes.PowerShellToolDetails | undefined;
  }

  interface ReadToolResultEvent extends ToolResultEventBase {
    toolName: "read";
    details: toolsTypes.ReadToolDetails | undefined;
  }

  interface EditToolResultEvent extends ToolResultEventBase {
    toolName: "edit";
    details: editTypes.EditToolDetails | undefined;
  }

  interface WriteToolResultEvent extends ToolResultEventBase {
    toolName: "write";
    details: undefined;
  }

  interface GrepToolResultEvent extends ToolResultEventBase {
    toolName: "grep";
    details: toolsTypes.GrepToolDetails | undefined;
  }

  interface FindToolResultEvent extends ToolResultEventBase {
    toolName: "find";
    details: toolsTypes.FindToolDetails | undefined;
  }

  interface LsToolResultEvent extends ToolResultEventBase {
    toolName: "ls";
    details: toolsTypes.LsToolDetails | undefined;
  }

  interface CustomToolResultEvent extends ToolResultEventBase {
    toolName: string;
    details: unknown;
  }

  type ToolResultEvent =
    | BashToolResultEvent
    | PowerShellToolResultEvent
    | ReadToolResultEvent
    | EditToolResultEvent
    | WriteToolResultEvent
    | GrepToolResultEvent
    | FindToolResultEvent
    | LsToolResultEvent
    | CustomToolResultEvent;
}

export type { typesAgentEventsTypes as default };
