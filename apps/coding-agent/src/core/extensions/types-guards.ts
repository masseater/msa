import type {
  BashToolCallEvent,
  BashToolResultEvent,
  EditToolCallEvent,
  EditToolResultEvent,
  FindToolCallEvent,
  FindToolResultEvent,
  GrepToolCallEvent,
  GrepToolResultEvent,
  LsToolCallEvent,
  LsToolResultEvent,
  PowerShellToolCallEvent,
  PowerShellToolResultEvent,
  ReadToolCallEvent,
  ReadToolResultEvent,
  ToolCallEvent,
  ToolResultEvent,
  WriteToolCallEvent,
  WriteToolResultEvent,
} from "./types-agent-events.ts";

type WithInputType<TInput> = ToolCallEvent & { readonly inputType?: TInput };

export function isBashToolResult(e: ToolResultEvent): e is BashToolResultEvent {
  return e.toolName === "bash";
}
export function isPowerShellToolResult(e: ToolResultEvent): e is PowerShellToolResultEvent {
  return e.toolName === "powershell";
}
export function isReadToolResult(e: ToolResultEvent): e is ReadToolResultEvent {
  return e.toolName === "read";
}
export function isEditToolResult(e: ToolResultEvent): e is EditToolResultEvent {
  return e.toolName === "edit";
}
export function isWriteToolResult(e: ToolResultEvent): e is WriteToolResultEvent {
  return e.toolName === "write";
}
export function isGrepToolResult(e: ToolResultEvent): e is GrepToolResultEvent {
  return e.toolName === "grep";
}
export function isFindToolResult(e: ToolResultEvent): e is FindToolResultEvent {
  return e.toolName === "find";
}
export function isLsToolResult(e: ToolResultEvent): e is LsToolResultEvent {
  return e.toolName === "ls";
}

export function isToolCallEventType(event: ToolCallEvent): (toolName: "bash") => boolean;
export function isToolCallEventType(
  toolName: "bash",
  event: ToolCallEvent,
): event is BashToolCallEvent;
export function isToolCallEventType(event: ToolCallEvent): (toolName: "powershell") => boolean;
export function isToolCallEventType(
  toolName: "powershell",
  event: ToolCallEvent,
): event is PowerShellToolCallEvent;
export function isToolCallEventType(event: ToolCallEvent): (toolName: "read") => boolean;
export function isToolCallEventType(
  toolName: "read",
  event: ToolCallEvent,
): event is ReadToolCallEvent;
export function isToolCallEventType(event: ToolCallEvent): (toolName: "edit") => boolean;
export function isToolCallEventType(
  toolName: "edit",
  event: ToolCallEvent,
): event is EditToolCallEvent;
export function isToolCallEventType(event: ToolCallEvent): (toolName: "write") => boolean;
export function isToolCallEventType(
  toolName: "write",
  event: ToolCallEvent,
): event is WriteToolCallEvent;
export function isToolCallEventType(event: ToolCallEvent): (toolName: "grep") => boolean;
export function isToolCallEventType(
  toolName: "grep",
  event: ToolCallEvent,
): event is GrepToolCallEvent;
export function isToolCallEventType(event: ToolCallEvent): (toolName: "find") => boolean;
export function isToolCallEventType(
  toolName: "find",
  event: ToolCallEvent,
): event is FindToolCallEvent;
export function isToolCallEventType(event: ToolCallEvent): (toolName: "ls") => boolean;
export function isToolCallEventType(toolName: "ls", event: ToolCallEvent): event is LsToolCallEvent;
export function isToolCallEventType<
  TName extends string,
  TInput extends Record<string, unknown> = Record<string, unknown>,
>(event: WithInputType<TInput>): (toolName: TName) => boolean;
export function isToolCallEventType<
  TName extends string,
  TInput extends Record<string, unknown> = Record<string, unknown>,
>(
  toolName: TName,
  event: WithInputType<TInput>,
): event is ToolCallEvent & { toolName: TName; input: TInput };
export function isToolCallEventType(...args: unknown[]): unknown {
  const [first, second] = args as [string | ToolCallEvent, ToolCallEvent | undefined];
  if (typeof first === "string") return second?.toolName === first;
  return (toolName: string) => first.toolName === toolName;
}
