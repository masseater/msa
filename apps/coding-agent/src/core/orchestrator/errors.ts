import OrchestratorError from "./orchestrator-error.ts";

function orchestratorError(error: unknown): OrchestratorError {
  return new OrchestratorError({
    cause: error,
    message: error instanceof Error ? error.message : String(error),
  });
}

const errors = {
  orchestratorError,
};

export default errors;
