import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import defaults from "../defaults.ts";
import type SettingsManager from "../settings-manager.ts";

const { DEFAULT_THINKING_LEVEL } = defaults;
const { clampThinkingLevel } = compat;

type ThinkingContext = {
  requested: agentTypes.ThinkingLevel | undefined;
  settingsManager: SettingsManager;
  model: compatTypes.Model<any> | undefined;
  hasExistingSession: boolean;
  sessionThinkingLevel: string | undefined;
};

const preferredThinkingLevel = (context: ThinkingContext): agentTypes.ThinkingLevel => {
  const { requested, settingsManager, model, hasExistingSession, sessionThinkingLevel } = context;
  if (requested !== undefined) return requested;
  const configuredDefault =
    settingsManager.models.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
  if (hasExistingSession) {
    return sessionThinkingLevel === undefined
      ? configuredDefault
      : (sessionThinkingLevel as agentTypes.ThinkingLevel);
  }
  if (model !== undefined) {
    const perModel = settingsManager.models.getModelThinkingLevel(model.provider, model.id);
    if (perModel !== undefined) return perModel;
  }
  return configuredDefault;
};

const initialThinkingLevel = (context: ThinkingContext): agentTypes.ThinkingLevel =>
  context.model === undefined
    ? "off"
    : (clampThinkingLevel(
        context.model,
        preferredThinkingLevel(context),
      ) as agentTypes.ThinkingLevel);

const thinkingLevel = { initialThinkingLevel };

export default thinkingLevel;
