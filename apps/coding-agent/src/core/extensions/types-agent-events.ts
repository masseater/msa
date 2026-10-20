import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type { EditToolDetails } from "../tools/edit.ts";
import type {
  BashToolDetails,
  BashToolInput,
  EditToolInput,
  FindToolDetails,
  FindToolInput,
  GrepToolDetails,
  GrepToolInput,
  LsToolDetails,
  LsToolInput,
  PowerShellToolDetails,
  PowerShellToolInput,
  ReadToolDetails,
  ReadToolInput,
  WriteToolInput,
} from "../tools/index.ts";
import type { BoundaryState } from "./types-session-events.ts";

export interface TurnStartEvent {
  type: "turn_start";
  turnIndex: number;
  timestamp: number;
}

export interface TurnEndEvent extends BoundaryState {
  type: "turn_end";
  turnIndex: number;
  message: agentTypes.AgentMessage;
  toolResults: aiTypes.ToolResultMessage[];
  messageEntryId: string;
  toolResultEntryIds: string[];
}

export interface MessageStartEvent {
  type: "message_start";
  message: agentTypes.AgentMessage;
}

export interface MessageUpdateEvent {
  type: "message_update";
  message: agentTypes.AgentMessage;
  assistantMessageEvent: aiTypes.AssistantMessageEvent;
}

export interface MessageEndEvent {
  type: "message_end";
  message: agentTypes.AgentMessage;
}

export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: any;
  parentToolCallId?: string;
}

export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: any;
  partialResult: any;
  parentToolCallId?: string;
}

export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: any;
  isError: boolean;
  durationMs?: number;
  parentToolCallId?: string;
}

export type ModelSelectSource = "set" | "cycle" | "restore";

export interface ModelSelectEvent {
  type: "model_select";
  model: aiTypes.Model<any>;
  previousModel: aiTypes.Model<any> | undefined;
  source: ModelSelectSource;
}

export interface ThinkingLevelSelectEvent {
  type: "thinking_level_select";
  level: agentTypes.ThinkingLevel;
  previousLevel: agentTypes.ThinkingLevel;
}

export interface UserBashEvent {
  type: "user_bash";
  command: string;
  excludeFromContext: boolean;
  cwd: string;
}

export type InputSource = "interactive" | "rpc" | "extension";

export interface InputEvent {
  type: "input";
  text: string;
  images?: aiTypes.ImageContent[] | undefined;
  source: InputSource;
  streamingBehavior?: "steer" | "followUp" | undefined;
}

export type InputEventResult =
  | { action: "continue" }
  | { action: "transform"; text: string; images?: aiTypes.ImageContent[] | undefined }
  | { action: "handled" };

interface ToolCallEventBase {
  type: "tool_call";
  toolCallId: string;
  parentToolCallId?: string;
}

export interface BashToolCallEvent extends ToolCallEventBase {
  toolName: "bash";
  input: BashToolInput;
}

export interface PowerShellToolCallEvent extends ToolCallEventBase {
  toolName: "powershell";
  input: PowerShellToolInput;
}

export interface ReadToolCallEvent extends ToolCallEventBase {
  toolName: "read";
  input: ReadToolInput;
}

export interface EditToolCallEvent extends ToolCallEventBase {
  toolName: "edit";
  input: EditToolInput;
}

export interface WriteToolCallEvent extends ToolCallEventBase {
  toolName: "write";
  input: WriteToolInput;
}

export interface GrepToolCallEvent extends ToolCallEventBase {
  toolName: "grep";
  input: GrepToolInput;
}

export interface FindToolCallEvent extends ToolCallEventBase {
  toolName: "find";
  input: FindToolInput;
}

export interface LsToolCallEvent extends ToolCallEventBase {
  toolName: "ls";
  input: LsToolInput;
}

export interface CustomToolCallEvent extends ToolCallEventBase {
  toolName: string;
  input: Record<string, unknown>;
}

export type ToolCallEvent =
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

export interface BashToolResultEvent extends ToolResultEventBase {
  toolName: "bash";
  details: BashToolDetails | undefined;
}

export interface PowerShellToolResultEvent extends ToolResultEventBase {
  toolName: "powershell";
  details: PowerShellToolDetails | undefined;
}

export interface ReadToolResultEvent extends ToolResultEventBase {
  toolName: "read";
  details: ReadToolDetails | undefined;
}

export interface EditToolResultEvent extends ToolResultEventBase {
  toolName: "edit";
  details: EditToolDetails | undefined;
}

export interface WriteToolResultEvent extends ToolResultEventBase {
  toolName: "write";
  details: undefined;
}

export interface GrepToolResultEvent extends ToolResultEventBase {
  toolName: "grep";
  details: GrepToolDetails | undefined;
}

export interface FindToolResultEvent extends ToolResultEventBase {
  toolName: "find";
  details: FindToolDetails | undefined;
}

export interface LsToolResultEvent extends ToolResultEventBase {
  toolName: "ls";
  details: LsToolDetails | undefined;
}

export interface CustomToolResultEvent extends ToolResultEventBase {
  toolName: string;
  details: unknown;
}

export type ToolResultEvent =
  | BashToolResultEvent
  | PowerShellToolResultEvent
  | ReadToolResultEvent
  | EditToolResultEvent
  | WriteToolResultEvent
  | GrepToolResultEvent
  | FindToolResultEvent
  | LsToolResultEvent
  | CustomToolResultEvent;
