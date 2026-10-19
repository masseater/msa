import type { ToolDefinition } from "../extensions/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import { ORCHESTRATOR_TOOL_NAMES } from "./tool-names.ts";
import { handoffTools } from "./tools-handoff.ts";
import { messageToolsA, messageToolsB, messageToolsC } from "./tools-message.ts";
import { replanTools } from "./tools-replan.ts";
import { taskToolsA, taskToolsB } from "./tools-task.ts";

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
    ...handoffTools(orchestrator),
  } as Record<(typeof ORCHESTRATOR_TOOL_NAMES)[number], ToolDefinition>;
}
