import type extensionsTypesTypes from "../extensions/types.types.ts";
import decisionRequest from "./decision-request.ts";
import reviewChecklist from "./review-checklist.ts";
import type runtimeTypes from "./runtime.types.ts";
import triageTool from "./triage-tool.ts";
import type orchestratorTypesTypes from "./types.types.ts";

function toolsFor(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  role: orchestratorTypesTypes.ThreadRole,
  task: orchestratorTypesTypes.Task,
): extensionsTypesTypes.ToolDefinition[] {
  if (role === "advisor") return [];
  if (role === "triage") return [triageTool.concludeTool(runtime, threadId, task)];
  const request = decisionRequest.requestDecisionTool(runtime, threadId, role);
  if (role === "worker" || task.kind !== "work") return [request];
  return [request, reviewChecklist.recordTool(runtime, threadId, task)];
}

function readOnly(role: orchestratorTypesTypes.ThreadRole): boolean {
  return role === "advisor" || role === "triage";
}

const threadTools = { readOnly, toolsFor };

export default threadTools;
