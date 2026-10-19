import type { ToolDefinition } from "../extensions/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { messageToolsA, messageToolsB, messageToolsC } from "./tools-message.ts";
import { replanTools } from "./tools-replan.ts";
import { taskToolsA, taskToolsB } from "./tools-task.ts";

export const ORCHESTRATOR_TOOL_NAMES = [
  "create_task",
  "list_tasks",
  "read_task",
  "add_dependency",
  "remove_dependency",
  "set_task_priority",
  "set_task_model",
  "send_message",
  "send_note",
  "search_reports",
  "stop_task",
  "rerun_task",
  "set_max_concurrent_sessions",
  "replan",
] as const;

export function isOrchestratorTool(name: string): boolean {
  return (ORCHESTRATOR_TOOL_NAMES as readonly string[]).includes(name);
}

export function createOrchestratorToolDefinitions(
  orchestrator: Orchestrator,
): Record<(typeof ORCHESTRATOR_TOOL_NAMES)[number], ToolDefinition> {
  return {
    ...taskToolsA(orchestrator),
    ...taskToolsB(orchestrator),
    ...messageToolsA(orchestrator),
    ...messageToolsC(orchestrator),
    ...messageToolsB(orchestrator),
    ...replanTools(orchestrator),
  } as Record<(typeof ORCHESTRATOR_TOOL_NAMES)[number], ToolDefinition>;
}
