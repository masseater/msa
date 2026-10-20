import type aiTypes from "@msa/ai/index.types";

import { findModelUpgrades } from "../src/core/model-upgrade.ts";
import type { Settings } from "../src/core/settings-schema.ts";

function model(provider: string, id: string): aiTypes.Model<aiTypes.Api> {
  return { id, name: id, provider } as unknown as aiTypes.Model<aiTypes.Api>;
}

function upgradePair(): {
  candidates: ReturnType<typeof findModelUpgrades>;
} {
  return {
    candidates: findModelUpgrades([
      model("anthropic-api", "claude-sonnet-4-5"),
      model("anthropic-api", "claude-sonnet-5-5"),
    ]),
  };
}

function settingsNamingTheOldModel(): Settings {
  return {
    compaction: { modelOverrides: { "anthropic-api/claude-sonnet-4-5": { reserveTokens: 1 } } },
    defaultModel: "claude-sonnet-4-5",
    defaultProvider: "anthropic-api",
    enabledModels: ["anthropic-api/claude-sonnet-4-5:high", "openai/gpt-5.5"],
    goal: { evaluatorModel: "anthropic-api/claude-sonnet-4-5" },
    modelPolicy: { allow: ["anthropic-api/*"], deny: ["anthropic-api/claude-sonnet-4-5"] },
    modelThinkingLevels: { "anthropic-api/claude-sonnet-4-5": "high" },
    orchestrator: { workerModel: "anthropic-api/claude-sonnet-4-5" },
  } as Settings;
}

const modelUpgradeSupport = {
  model,
  settingsNamingTheOldModel,
  upgradePair,
};

export default modelUpgradeSupport;
