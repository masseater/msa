import type decideTypes from "../core/decision/decide.types.ts";
import decisionModel from "../core/decision/decision-model.ts";
import platform from "../core/platform/index.ts";
import type mainInternalTypes from "./main-internal.types.ts";

const { prepareDecisionModel } = decisionModel;
const { writeError } = platform;

function reportFailure(preparation: decideTypes.DecisionModelPreparation): void {
  if (preparation.status === "failed")
    writeError(`Could not load decision model ${preparation.model}: ${preparation.reason}`);
}

function startDecisionModel(
  startup: Pick<mainInternalTypes.Startup, "appMode" | "offlineMode">,
  runtime: {
    readonly services: Pick<
      mainInternalTypes.Runtime["services"],
      "modelRuntime" | "settingsManager"
    >;
  },
): Promise<decideTypes.DecisionModelPreparation> | undefined {
  if (startup.offlineMode) return undefined;
  if (startup.appMode !== "interactive" && startup.appMode !== "rpc") return undefined;
  const { modelRuntime, settingsManager } = runtime.services;
  const preparation = prepareDecisionModel(settingsManager.models, modelRuntime);
  if (startup.appMode === "rpc") void preparation.then(reportFailure);
  return preparation;
}

const decisionModelStartup = { startDecisionModel };

export default decisionModelStartup;
