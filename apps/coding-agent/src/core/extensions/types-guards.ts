import type typesAgentEventsTypes from "./types-agent-events.ts";

type WithInputType<TInput> = typesAgentEventsTypes.ToolCallEvent & { readonly inputType?: TInput };

function isBashToolResult(
  e: typesAgentEventsTypes.ToolResultEvent,
): e is typesAgentEventsTypes.BashToolResultEvent {
  return e.toolName === "bash";
}
function isPowerShellToolResult(
  e: typesAgentEventsTypes.ToolResultEvent,
): e is typesAgentEventsTypes.PowerShellToolResultEvent {
  return e.toolName === "powershell";
}
function isReadToolResult(
  e: typesAgentEventsTypes.ToolResultEvent,
): e is typesAgentEventsTypes.ReadToolResultEvent {
  return e.toolName === "read";
}
function isEditToolResult(
  e: typesAgentEventsTypes.ToolResultEvent,
): e is typesAgentEventsTypes.EditToolResultEvent {
  return e.toolName === "edit";
}
function isWriteToolResult(
  e: typesAgentEventsTypes.ToolResultEvent,
): e is typesAgentEventsTypes.WriteToolResultEvent {
  return e.toolName === "write";
}
function isGrepToolResult(
  e: typesAgentEventsTypes.ToolResultEvent,
): e is typesAgentEventsTypes.GrepToolResultEvent {
  return e.toolName === "grep";
}
function isFindToolResult(
  e: typesAgentEventsTypes.ToolResultEvent,
): e is typesAgentEventsTypes.FindToolResultEvent {
  return e.toolName === "find";
}
function isLsToolResult(
  e: typesAgentEventsTypes.ToolResultEvent,
): e is typesAgentEventsTypes.LsToolResultEvent {
  return e.toolName === "ls";
}

function isToolCallEventType(
  event: typesAgentEventsTypes.ToolCallEvent,
): (toolName: "bash") => boolean;
function isToolCallEventType(
  toolName: "bash",
  event: typesAgentEventsTypes.ToolCallEvent,
): event is typesAgentEventsTypes.BashToolCallEvent;
function isToolCallEventType(
  event: typesAgentEventsTypes.ToolCallEvent,
): (toolName: "powershell") => boolean;
function isToolCallEventType(
  toolName: "powershell",
  event: typesAgentEventsTypes.ToolCallEvent,
): event is typesAgentEventsTypes.PowerShellToolCallEvent;
function isToolCallEventType(
  event: typesAgentEventsTypes.ToolCallEvent,
): (toolName: "read") => boolean;
function isToolCallEventType(
  toolName: "read",
  event: typesAgentEventsTypes.ToolCallEvent,
): event is typesAgentEventsTypes.ReadToolCallEvent;
function isToolCallEventType(
  event: typesAgentEventsTypes.ToolCallEvent,
): (toolName: "edit") => boolean;
function isToolCallEventType(
  toolName: "edit",
  event: typesAgentEventsTypes.ToolCallEvent,
): event is typesAgentEventsTypes.EditToolCallEvent;
function isToolCallEventType(
  event: typesAgentEventsTypes.ToolCallEvent,
): (toolName: "write") => boolean;
function isToolCallEventType(
  toolName: "write",
  event: typesAgentEventsTypes.ToolCallEvent,
): event is typesAgentEventsTypes.WriteToolCallEvent;
function isToolCallEventType(
  event: typesAgentEventsTypes.ToolCallEvent,
): (toolName: "grep") => boolean;
function isToolCallEventType(
  toolName: "grep",
  event: typesAgentEventsTypes.ToolCallEvent,
): event is typesAgentEventsTypes.GrepToolCallEvent;
function isToolCallEventType(
  event: typesAgentEventsTypes.ToolCallEvent,
): (toolName: "find") => boolean;
function isToolCallEventType(
  toolName: "find",
  event: typesAgentEventsTypes.ToolCallEvent,
): event is typesAgentEventsTypes.FindToolCallEvent;
function isToolCallEventType(
  event: typesAgentEventsTypes.ToolCallEvent,
): (toolName: "ls") => boolean;
function isToolCallEventType(
  toolName: "ls",
  event: typesAgentEventsTypes.ToolCallEvent,
): event is typesAgentEventsTypes.LsToolCallEvent;
function isToolCallEventType<
  TName extends string,
  TInput extends Record<string, unknown> = Record<string, unknown>,
>(event: WithInputType<TInput>): (toolName: TName) => boolean;
function isToolCallEventType<
  TName extends string,
  TInput extends Record<string, unknown> = Record<string, unknown>,
>(
  toolName: TName,
  event: WithInputType<TInput>,
): event is typesAgentEventsTypes.ToolCallEvent & { toolName: TName; input: TInput };
function isToolCallEventType(...args: unknown[]): unknown {
  const [first, second] = args as [
    string | typesAgentEventsTypes.ToolCallEvent,
    typesAgentEventsTypes.ToolCallEvent | undefined,
  ];
  if (typeof first === "string") return second?.toolName === first;
  return (toolName: string) => first.toolName === toolName;
}

const typesGuards = {
  isBashToolResult,
  isEditToolResult,
  isFindToolResult,
  isGrepToolResult,
  isLsToolResult,
  isPowerShellToolResult,
  isReadToolResult,
  isToolCallEventType,
  isWriteToolResult,
};

export default typesGuards;
