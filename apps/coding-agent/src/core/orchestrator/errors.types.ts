import type OrchestratorErrorClass from "./orchestrator-error.ts";
import type UncheckableCwdClass from "./uncheckable-cwd.ts";

declare namespace errorsTypes {
  type OrchestratorError = (typeof OrchestratorErrorClass)["prototype"];

  type UncheckableCwd = (typeof UncheckableCwdClass)["prototype"];
}

export type { errorsTypes as default };
