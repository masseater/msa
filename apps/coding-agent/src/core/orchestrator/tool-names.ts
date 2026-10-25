const ORCHESTRATOR_TOOL_NAMES = [
  "create_task",
  "list_tasks",
  "read_task",
  "set_task_depends",
  "set_task_state",
  "set_task_model",
  "send_message",
  "consult_advisor",
  "send_note",
  "search_reports",
  "stop_task",
  "rerun_task",
  "set_max_concurrent_threads",
  "replan",
  "handoff",
] as const;

function isOrchestratorTool(name: string): boolean {
  return (ORCHESTRATOR_TOOL_NAMES as readonly string[]).includes(name);
}

const toolNames = {
  ORCHESTRATOR_TOOL_NAMES,
  isOrchestratorTool,
};

export default toolNames;
