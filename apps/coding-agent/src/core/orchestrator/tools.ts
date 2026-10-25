import type extensionsTypesTypes from "../extensions/types.types.ts";
import type orchestratorTypes from "./orchestrator.types.ts";
import type toolNames from "./tool-names.ts";
import toolsHandoff from "./tools-handoff.ts";
import toolsMessage from "./tools-message.ts";
import toolsReplan from "./tools-replan.ts";
import toolsTask from "./tools-task.ts";

const { createAndReadTaskTools, editTaskTools } = toolsTask;
const { decisionTools, messageToolsA, messageToolsB, messageToolsC } = toolsMessage;
const { replanTools } = toolsReplan;
const { handoffTools } = toolsHandoff;

function createOrchestratorToolDefinitions(
  orchestrator: orchestratorTypes.Orchestrator,
): Record<(typeof toolNames.ORCHESTRATOR_TOOL_NAMES)[number], extensionsTypesTypes.ToolDefinition> {
  return {
    ...createAndReadTaskTools(orchestrator),
    ...editTaskTools(orchestrator),
    ...messageToolsA(orchestrator),
    ...decisionTools(orchestrator),
    ...messageToolsC(orchestrator),
    ...messageToolsB(orchestrator),
    ...replanTools(orchestrator),
    ...handoffTools(orchestrator),
  } as Record<
    (typeof toolNames.ORCHESTRATOR_TOOL_NAMES)[number],
    extensionsTypesTypes.ToolDefinition
  >;
}

const tools = {
  createOrchestratorToolDefinitions,
};

export default tools;
