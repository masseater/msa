import type agentTypes from "@msa/agent-core/index.types";

import modelPolicyModule from "../model-policy.ts";
import type modelPolicyTypes from "../model-policy.types.ts";
import settingsDefaults from "../settings-defaults.ts";
import settingsManagerHelpers from "../settings-manager-helpers.ts";
import type SettingsManager from "../settings-manager.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { readModelPolicy } = settingsManagerHelpers;
const { SETTINGS_DEFAULTS } = settingsDefaults;
const { EMPTY_MODEL_POLICY, mergeModelPolicies } = modelPolicyModule;

export default class ModelSettings {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
  }

  getDefaultProvider(): string | undefined {
    return this.manager.settings.defaultProvider;
  }

  getDefaultModel(): string | undefined {
    return this.manager.settings.defaultModel;
  }

  getGoalEvaluatorModel(): string | undefined {
    return this.manager.settings.goal?.evaluatorModel;
  }

  getOrchestratorWorkerModel(): string | undefined {
    return this.manager.settings.orchestrator?.workerModel;
  }

  getOrchestratorReviewModel(): string | undefined {
    return this.manager.settings.orchestrator?.reviewModel;
  }

  getThinkingBudgets(): settingsSchemaTypes.ThinkingBudgetsSettings | undefined {
    return this.manager.settings.thinkingBudgets;
  }

  getEnabledModels(): string[] | undefined {
    return this.manager.settings.enabledModels;
  }

  getDefaultThinkingLevel(): agentTypes.ThinkingLevel | undefined {
    return this.manager.settings.defaultThinkingLevel;
  }

  getModelThinkingLevel(provider: string, modelId: string): agentTypes.ThinkingLevel | undefined {
    return this.manager.settings.modelThinkingLevels?.[`${provider}/${modelId}`];
  }

  getAllModelThinkingLevels(): Record<string, agentTypes.ThinkingLevel> {
    return { ...(this.manager.settings.modelThinkingLevels ?? {}) };
  }

  getTransport(): settingsSchemaTypes.TransportSetting {
    return this.manager.settings.transport ?? SETTINGS_DEFAULTS.transport;
  }

  getOrchestratorWorkerThinkingLevel(): agentTypes.ThinkingLevel | undefined {
    return this.manager.settings.orchestrator?.workerThinkingLevel;
  }

  getOrchestratorReviewThinkingLevel(): agentTypes.ThinkingLevel | undefined {
    return this.manager.settings.orchestrator?.reviewThinkingLevel;
  }

  setDefaultProvider(provider: string): void {
    this.manager.persistence.setGlobalSetting("defaultProvider", provider);
  }

  setDefaultModel(modelId: string): void {
    this.manager.persistence.setGlobalSetting("defaultModel", modelId);
  }

  setDefaultModelAndProvider(provider: string, modelId: string): void {
    this.manager.globalSettings.defaultProvider = provider;
    this.manager.globalSettings.defaultModel = modelId;
    this.manager.persistence.markModified("defaultProvider");
    this.manager.persistence.markModified("defaultModel");
    this.manager.persistence.save();
  }

  setTransport(transport: settingsSchemaTypes.TransportSetting): void {
    this.manager.persistence.setGlobalSetting("transport", transport);
  }

  setDefaultThinkingLevel(level: agentTypes.ThinkingLevel): void {
    this.manager.persistence.setGlobalSetting("defaultThinkingLevel", level);
  }

  setModelThinkingLevel(provider: string, modelId: string, level: agentTypes.ThinkingLevel): void {
    if (this.manager.globalSettings.modelThinkingLevels === undefined) {
      this.manager.globalSettings.modelThinkingLevels = {};
    }
    this.manager.globalSettings.modelThinkingLevels[`${provider}/${modelId}`] = level;
    this.manager.persistence.markModified("modelThinkingLevels");
    this.manager.persistence.save();
  }

  removeModelThinkingLevel(provider: string, modelId: string): void {
    if (this.manager.globalSettings.modelThinkingLevels === undefined) return;
    delete this.manager.globalSettings.modelThinkingLevels[`${provider}/${modelId}`];
    if (Object.keys(this.manager.globalSettings.modelThinkingLevels).length === 0) {
      delete this.manager.globalSettings.modelThinkingLevels;
    }
    this.manager.persistence.markModified("modelThinkingLevels");
    this.manager.persistence.save();
  }

  setEnabledModels(patterns: string[] | undefined): void {
    this.manager.persistence.setGlobalSetting("enabledModels", patterns);
  }

  getModelPolicy(): modelPolicyTypes.ModelPolicy {
    return mergeModelPolicies(
      readModelPolicy(this.manager.globalSettings),
      this.manager.projectTrusted
        ? readModelPolicy(this.manager.projectSettings)
        : EMPTY_MODEL_POLICY,
    );
  }

  setModelPolicy(policy: modelPolicyTypes.ModelPolicy): void {
    const allow = policy.allow.map((pattern) => pattern.trim()).filter(Boolean);
    const deny = policy.deny.map((pattern) => pattern.trim()).filter(Boolean);
    const saved = { ...(allow.length > 0 ? { allow } : {}), ...(deny.length > 0 ? { deny } : {}) };
    this.manager.persistence.setGlobalSetting(
      "modelPolicy",
      allow.length === 0 && deny.length === 0 ? undefined : saved,
    );
  }

  rewriteModelReferences<TChange>(rewrite: (settings: settingsSchemaTypes.Settings) => TChange[]): {
    global: TChange[];
    project: TChange[];
  } {
    const rewriteLayer = (
      scope: settingsManagerTypes.SettingsScope,
      current: settingsSchemaTypes.Settings,
      apply: (settings: settingsSchemaTypes.Settings) => void,
    ): TChange[] => {
      const next = structuredClone(current) as Record<string, unknown>;
      const changes = rewrite(next as settingsSchemaTypes.Settings);
      if (changes.length === 0) return changes;
      for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
        if (JSON.stringify((current as Record<string, unknown>)[key]) === JSON.stringify(next[key]))
          continue;
        if (scope === "global")
          this.manager.persistence.markModified(key as keyof settingsSchemaTypes.Settings);
        else
          this.manager.persistence.markProjectModified(key as keyof settingsSchemaTypes.Settings);
      }
      apply(next as settingsSchemaTypes.Settings);
      return changes;
    };

    const global = rewriteLayer("global", this.manager.globalSettings, (settings) => {
      this.manager.globalSettings = settings;
      this.manager.persistence.save();
    });
    const project = this.manager.projectTrusted
      ? rewriteLayer("project", this.manager.projectSettings, (settings) =>
          this.manager.persistence.saveProjectSettings(settings),
        )
      : [];
    return { global, project };
  }
}
