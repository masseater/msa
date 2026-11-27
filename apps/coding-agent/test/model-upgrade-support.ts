import modelUpgrade from "../src/core/model-upgrade.ts";
import type settingsSchemaTypes from "../src/core/settings-schema.types.ts";
import modelLifecycleSupport from "./model-lifecycle-support.ts";

const { model } = modelLifecycleSupport;

const { findModelUpgrades } = modelUpgrade;

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

function settingsNamingTheOldModel(): settingsSchemaTypes.Settings {
  return {
    compaction: { modelOverrides: { "anthropic-api/claude-sonnet-4-5": { reserveTokens: 1 } } },
    defaultModel: "claude-sonnet-4-5",
    defaultProvider: "anthropic-api",
    enabledModels: ["anthropic-api/claude-sonnet-4-5:high", "openai/gpt-5.5"],
    goal: { evaluatorModel: "anthropic-api/claude-sonnet-4-5" },
    modelPolicy: { allow: ["anthropic-api/*"], deny: ["anthropic-api/claude-sonnet-4-5"] },
    modelThinkingLevels: { "anthropic-api/claude-sonnet-4-5": "high" },
    orchestrator: { workerModel: "anthropic-api/claude-sonnet-4-5" },
  } as settingsSchemaTypes.Settings;
}

const modelUpgradeSupport = {
  model,
  settingsNamingTheOldModel,
  upgradePair,
};

export default modelUpgradeSupport;
