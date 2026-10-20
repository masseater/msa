import type agentTypes from "@msa/agent-core/index.types";
import type tuiTypes from "@msa/tui/index.types";

import config from "../config.ts";
import pathsModule from "../utils/paths.ts";
import httpDispatcher from "./http-dispatcher.ts";
import modelPolicyModule from "./model-policy.ts";
import type modelPolicyTypes from "./model-policy.types.ts";
import platformNode from "./platform-node.ts";
import settingsManagerHelpers from "./settings-manager-helpers.ts";
import SettingsManagerLayer3 from "./settings-manager-layer-3.ts";
import SettingsManager from "./settings-manager.ts";

const { dirname, join, randomUuid } = platformNode;
const { getAgentDir } = config;
const { resolvePath } = pathsModule;
const { DEFAULT_HTTP_IDLE_TIMEOUT_MS } = httpDispatcher;
const { EMPTY_MODEL_POLICY, mergeModelPolicies } = modelPolicyModule;
const { deepMergeSettings, parseTimeoutSetting, readModelPolicy } = settingsManagerHelpers;

export default abstract class SettingsManagerLayer4 extends SettingsManagerLayer3 {
  setProjectTrusted(trusted: boolean): void {
    if (this.projectTrusted === trusted) {
      return;
    }

    this.projectTrusted = trusted;
    this.modifiedProjectFields.clear();
    this.modifiedProjectNestedFields.clear();

    if (!trusted) {
      this.projectSettings = {};
      this.projectSettingsLoadError = null;
      this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
      return;
    }

    const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", trusted);
    this.projectSettings = projectLoad.settings;
    this.projectSettingsLoadError = projectLoad.error;
    if (projectLoad.error !== null) {
      this.recordError("project", projectLoad.error);
    }
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  setDefaultThinkingLevel(level: agentTypes.ThinkingLevel): void {
    this.setGlobalSetting("defaultThinkingLevel", level);
  }

  setModelThinkingLevel(provider: string, modelId: string, level: agentTypes.ThinkingLevel): void {
    if (this.globalSettings.modelThinkingLevels === undefined) {
      this.globalSettings.modelThinkingLevels = {};
    }
    this.globalSettings.modelThinkingLevels[`${provider}/${modelId}`] = level;
    this.markModified("modelThinkingLevels");
    this.save();
  }

  removeModelThinkingLevel(provider: string, modelId: string): void {
    if (this.globalSettings.modelThinkingLevels === undefined) return;
    delete this.globalSettings.modelThinkingLevels[`${provider}/${modelId}`];
    if (Object.keys(this.globalSettings.modelThinkingLevels).length === 0) {
      delete this.globalSettings.modelThinkingLevels;
    }
    this.markModified("modelThinkingLevels");
    this.save();
  }

  getOrchestratorDatabasePath(): string {
    const configured = this.settings.orchestrator?.database?.trim();
    const agentDir =
      this.settingsPaths.global !== undefined && this.settingsPaths.global !== ""
        ? dirname(this.settingsPaths.global)
        : getAgentDir();
    return configured !== undefined && configured !== ""
      ? resolvePath(configured, agentDir)
      : join(agentDir, "orchestrator.db");
  }

  getHandoffDirectory(): string {
    const agentDir =
      this.settingsPaths.global !== undefined && this.settingsPaths.global !== ""
        ? dirname(this.settingsPaths.global)
        : getAgentDir();
    return join(agentDir, "handoffs");
  }

  getHttpIdleTimeoutMs(): number {
    return (
      parseTimeoutSetting(this.settings.httpIdleTimeoutMs, "httpIdleTimeoutMs") ??
      DEFAULT_HTTP_IDLE_TIMEOUT_MS
    );
  }

  setHttpIdleTimeoutMs(timeoutMs: number): void {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error(`Invalid httpIdleTimeoutMs setting: ${String(timeoutMs)}`);
    }
    this.setGlobalSetting("httpIdleTimeoutMs", Math.floor(timeoutMs));
  }

  setEnableAnalytics(enabled: boolean): void {
    this.globalSettings.enableAnalytics = enabled;
    this.markModified("enableAnalytics");
    if (
      enabled &&
      (this.globalSettings.trackingId === undefined || this.globalSettings.trackingId === "")
    ) {
      this.globalSettings.trackingId = randomUuid();
      this.markModified("trackingId");
    }
    this.save();
  }

  getOrCreateDeviceId(): string {
    if (this.globalSettings.deviceId === undefined || this.globalSettings.deviceId === "") {
      this.globalSettings.deviceId = randomUuid();
      this.markModified("deviceId");
      this.save();
    }
    return this.globalSettings.deviceId;
  }

  setFullscreenScrollbar(mode: tuiTypes.ScrollViewScrollbar): void {
    this.setGlobalSetting("fullscreenScrollbar", mode);
  }

  setFullscreenCopyOnSelect(enabled: boolean): void {
    this.setGlobalSetting("fullscreenCopyOnSelect", enabled);
  }

  setEnabledModels(patterns: string[] | undefined): void {
    this.setGlobalSetting("enabledModels", patterns);
  }

  getModelPolicy(): modelPolicyTypes.ModelPolicy {
    return mergeModelPolicies(
      readModelPolicy(this.globalSettings),
      this.projectTrusted ? readModelPolicy(this.projectSettings) : EMPTY_MODEL_POLICY,
    );
  }

  setModelPolicy(policy: modelPolicyTypes.ModelPolicy): void {
    const allow = policy.allow.map((pattern) => pattern.trim()).filter(Boolean);
    const deny = policy.deny.map((pattern) => pattern.trim()).filter(Boolean);
    const saved = { ...(allow.length > 0 ? { allow } : {}), ...(deny.length > 0 ? { deny } : {}) };
    this.setGlobalSetting(
      "modelPolicy",
      allow.length === 0 && deny.length === 0 ? undefined : saved,
    );
  }

  setDoubleEscapeAction(action: "fork" | "tree" | "none"): void {
    this.setGlobalSetting("doubleEscapeAction", action);
  }

  setTreeFilterMode(mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all"): void {
    this.setGlobalSetting("treeFilterMode", mode);
  }

  setShowHardwareCursor(enabled: boolean): void {
    this.setGlobalSetting("showHardwareCursor", enabled);
  }

  setEditorPaddingX(padding: number): void {
    this.setGlobalSetting("editorPaddingX", Math.max(0, Math.min(3, Math.floor(padding))));
  }

  setOutputPad(padding: 0 | 1): void {
    this.setGlobalSetting("outputPad", padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.setGlobalSetting(
      "autocompleteMaxVisible",
      Math.max(3, Math.min(20, Math.floor(maxVisible))),
    );
  }
}
