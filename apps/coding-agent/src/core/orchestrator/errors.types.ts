import type OrchestratorErrorClass from "./orchestrator-error.ts";

declare namespace errorsTypes {
  type OrchestratorError = (typeof OrchestratorErrorClass)["prototype"];
}

export type { errorsTypes as default };
