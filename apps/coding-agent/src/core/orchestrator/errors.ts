import OrchestratorError from "./orchestrator-error.ts";

function orchestratorError(error: unknown): OrchestratorError {
  return new OrchestratorError({
    cause: error,
    message: error instanceof Error ? error.message : String(error),
  });
}

function closedTaskMessage(taskId: string): string {
  return `${taskId} was closed by a replan and does not run again. Message the task that replaced it, or create a new task.`;
}

const errors = {
  closedTaskMessage,
  orchestratorError,
};

export default errors;
