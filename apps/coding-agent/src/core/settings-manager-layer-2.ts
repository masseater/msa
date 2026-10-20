import type agentTypes from "@msa/agent-core/index.types";
import type tuiTypes from "@msa/tui/index.types";

import pathsModule from "../utils/paths.ts";
import processEnv from "./process-env.ts";
import settingsDefaults from "./settings-defaults.ts";
import SettingsManagerLayer1 from "./settings-manager-layer-1.ts";
import settingsManagerSupport from "./settings-manager-support.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const { normalizePath } = pathsModule;
const { SETTINGS_DEFAULTS } = settingsDefaults;
const { CACHE_WARMING_MODES } = settingsManagerSupport;
const { readEnv } = processEnv;

export default abstract class SettingsManagerLayer2 extends SettingsManagerLayer1 {
  getSessionDir(): string | undefined {
    const sessionDir = this.settings.sessionDir;
    return sessionDir !== undefined && sessionDir !== "" ? normalizePath(sessionDir) : sessionDir;
  }

  getDefaultThinkingLevel(): agentTypes.ThinkingLevel | undefined {
    return this.settings.defaultThinkingLevel;
  }

  getModelThinkingLevel(provider: string, modelId: string): agentTypes.ThinkingLevel | undefined {
    return this.settings.modelThinkingLevels?.[`${provider}/${modelId}`];
  }

  getAllModelThinkingLevels(): Record<string, agentTypes.ThinkingLevel> {
    return { ...(this.settings.modelThinkingLevels ?? {}) };
  }

  getTransport(): settingsSchemaTypes.TransportSetting {
    return this.settings.transport ?? SETTINGS_DEFAULTS.transport;
  }

  getCompactionEnabled(): boolean {
    return this.settings.compaction?.enabled ?? SETTINGS_DEFAULTS.compaction.enabled;
  }

  getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } {
    return {
      reserveTokens:
        this.settings.branchSummary?.reserveTokens ?? SETTINGS_DEFAULTS.branchSummary.reserveTokens,
      skipPrompt:
        this.settings.branchSummary?.skipPrompt ?? SETTINGS_DEFAULTS.branchSummary.skipPrompt,
    };
  }

  getBranchSummarySkipPrompt(): boolean {
    return this.settings.branchSummary?.skipPrompt ?? SETTINGS_DEFAULTS.branchSummary.skipPrompt;
  }

  getOrchestratorWorkerThinkingLevel(): agentTypes.ThinkingLevel | undefined {
    return this.settings.orchestrator?.workerThinkingLevel;
  }

  getOrchestratorReviewThinkingLevel(): agentTypes.ThinkingLevel | undefined {
    return this.settings.orchestrator?.reviewThinkingLevel;
  }

  getOrchestratorMaxConcurrentThreads(): number {
    return (
      this.settings.orchestrator?.maxConcurrentThreads ??
      SETTINGS_DEFAULTS.orchestrator.maxConcurrentThreads
    );
  }

  getRetryEnabled(): boolean {
    return this.settings.retry?.enabled ?? SETTINGS_DEFAULTS.retry.enabled;
  }

  getRetrySettings(): {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxAgentDelayMs: number;
  } {
    return {
      baseDelayMs: this.settings.retry?.baseDelayMs ?? SETTINGS_DEFAULTS.retry.baseDelayMs,
      enabled: this.getRetryEnabled(),
      maxAgentDelayMs:
        this.settings.retry?.maxAgentDelayMs ?? SETTINGS_DEFAULTS.retry.maxAgentDelayMs,
      maxRetries: this.settings.retry?.maxRetries ?? SETTINGS_DEFAULTS.retry.maxRetries,
    };
  }

  getCacheWarmingMode(): settingsSchemaTypes.CacheWarmingMode {
    const mode = this.globalSettings.cacheWarming;
    return mode !== undefined && CACHE_WARMING_MODES.includes(mode)
      ? mode
      : SETTINGS_DEFAULTS.cacheWarming;
  }

  getProviderRetrySettings(): {
    timeoutMs?: number | undefined;
    maxRetries?: number | undefined;
    maxRetryDelayMs: number;
  } {
    return {
      maxRetries: this.settings.retry?.provider?.maxRetries,
      maxRetryDelayMs:
        this.settings.retry?.provider?.maxRetryDelayMs ??
        SETTINGS_DEFAULTS.retry.provider.maxRetryDelayMs,
      timeoutMs: this.settings.retry?.provider?.timeoutMs,
    };
  }

  getHideThinkingBlock(): boolean {
    return this.settings.hideThinkingBlock ?? SETTINGS_DEFAULTS.hideThinkingBlock;
  }

  getShowCacheMissNotices(): boolean {
    return this.settings.showCacheMissNotices ?? SETTINGS_DEFAULTS.showCacheMissNotices;
  }

  getExternalEditorCommand(): string {
    const configuredEditor = this.settings.externalEditor;
    if (typeof configuredEditor === "string" && configuredEditor.trim() !== "") {
      return configuredEditor;
    }
    const environmentEditor = readEnv("VISUAL") || readEnv("EDITOR");
    if (environmentEditor !== undefined && environmentEditor !== "") {
      return environmentEditor;
    }
    return process.platform === "win32" ? "notepad" : "nano";
  }

  getShellPath(): string | undefined {
    const shellPath = this.settings.shellPath;
    return shellPath !== undefined && shellPath !== "" ? normalizePath(shellPath) : shellPath;
  }

  getQuietStartup(): settingsSchemaTypes.QuietStartup {
    const value = this.settings.quietStartup;
    return value === true || value === "header" ? value : SETTINGS_DEFAULTS.quietStartup;
  }

  getDefaultProjectTrust(): settingsSchemaTypes.DefaultProjectTrust {
    const value = this.globalSettings.defaultProjectTrust;
    return value === "always" || value === "never" ? value : SETTINGS_DEFAULTS.defaultProjectTrust;
  }

  getCollapseChangelog(): boolean {
    return this.settings.collapseChangelog ?? SETTINGS_DEFAULTS.collapseChangelog;
  }

  getEnableInstallTelemetry(): boolean {
    return this.settings.enableInstallTelemetry ?? SETTINGS_DEFAULTS.enableInstallTelemetry;
  }

  getEnableAnalytics(): boolean {
    return this.settings.enableAnalytics ?? SETTINGS_DEFAULTS.enableAnalytics;
  }

  getEnableSkillCommands(): boolean {
    return this.settings.enableSkillCommands ?? SETTINGS_DEFAULTS.enableSkillCommands;
  }

  getShowImages(): boolean {
    return this.settings.terminal?.showImages ?? SETTINGS_DEFAULTS.terminal.showImages;
  }

  getImageWidthCells(): number {
    const width = this.settings.terminal?.imageWidthCells;
    if (typeof width !== "number" || !Number.isFinite(width)) {
      return SETTINGS_DEFAULTS.terminal.imageWidthCells;
    }
    return Math.max(1, Math.floor(width));
  }

  getClearOnShrink(): boolean {
    if (this.settings.terminal?.clearOnShrink !== undefined) {
      return this.settings.terminal.clearOnShrink;
    }
    if (readEnv("MSA_CLEAR_ON_SHRINK") === "1") return true;
    return SETTINGS_DEFAULTS.terminal.clearOnShrink;
  }

  getShowTerminalProgress(): boolean {
    return (
      this.settings.terminal?.showTerminalProgress ??
      SETTINGS_DEFAULTS.terminal.showTerminalProgress
    );
  }

  getTuiMode(): settingsSchemaTypes.TuiMode {
    return this.settings.tuiMode === "regular" ? "regular" : SETTINGS_DEFAULTS.tuiMode;
  }

  getFullscreenExitOutput(): settingsSchemaTypes.FullscreenExitOutput {
    return this.settings.fullscreenExitOutput === "resume-hint"
      ? "resume-hint"
      : SETTINGS_DEFAULTS.fullscreenExitOutput;
  }

  getFullscreenScrollbar(): tuiTypes.ScrollViewScrollbar {
    const mode = this.settings.fullscreenScrollbar;
    return mode === "always" || mode === "hidden" ? mode : SETTINGS_DEFAULTS.fullscreenScrollbar;
  }

  getFullscreenCopyOnSelect(): boolean {
    return this.settings.fullscreenCopyOnSelect ?? SETTINGS_DEFAULTS.fullscreenCopyOnSelect;
  }

  getFullscreenWheelScrollLines(): tuiTypes.WheelScrollLines {
    const lines = this.settings.fullscreenWheelScrollLines;
    return typeof lines === "number" && Number.isFinite(lines)
      ? Math.max(1, Math.min(100, Math.floor(lines)))
      : SETTINGS_DEFAULTS.fullscreenWheelScrollLines;
  }

  getImageAutoResize(): boolean {
    return this.settings.images?.autoResize ?? SETTINGS_DEFAULTS.images.autoResize;
  }

  getBlockImages(): boolean {
    return this.settings.images?.blockImages ?? SETTINGS_DEFAULTS.images.blockImages;
  }

  getPrWatchIntervalMs(): number {
    const seconds = this.settings.prWatch?.intervalSeconds;
    const value =
      typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 5
        ? seconds
        : SETTINGS_DEFAULTS.prWatch.intervalSeconds;
    return Math.round(value * 1000);
  }

  getPrWatchStatusIntervalMs(): number {
    const seconds = this.settings.prWatch?.statusIntervalSeconds;
    const value =
      typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 30
        ? seconds
        : SETTINGS_DEFAULTS.prWatch.statusIntervalSeconds;
    return Math.round(value * 1000);
  }

  getDoubleEscapeAction(): "fork" | "tree" | "none" {
    return this.settings.doubleEscapeAction ?? SETTINGS_DEFAULTS.doubleEscapeAction;
  }

  getTreeFilterMode(): "default" | "no-tools" | "user-only" | "labeled-only" | "all" {
    const mode = this.settings.treeFilterMode;
    const valid = ["default", "no-tools", "user-only", "labeled-only", "all"];
    return mode !== undefined && valid.includes(mode) ? mode : SETTINGS_DEFAULTS.treeFilterMode;
  }

  getShowHardwareCursor(): boolean {
    return this.settings.showHardwareCursor ?? readEnv("MSA_HARDWARE_CURSOR") === "1";
  }

  getEditorPaddingX(): number {
    return this.settings.editorPaddingX ?? SETTINGS_DEFAULTS.editorPaddingX;
  }

  getOutputPad(): 0 | 1 {
    return this.settings.outputPad === 0 ? 0 : SETTINGS_DEFAULTS.outputPad;
  }

  getAutocompleteMaxVisible(): number {
    return this.settings.autocompleteMaxVisible ?? SETTINGS_DEFAULTS.autocompleteMaxVisible;
  }

  getCodeBlockIndent(): string {
    return this.settings.markdown?.codeBlockIndent ?? SETTINGS_DEFAULTS.markdown.codeBlockIndent;
  }

  getMermaidRenderingMode(): settingsSchemaTypes.MermaidRenderingMode {
    const mode = this.settings.markdown?.mermaid;
    return mode === "off" || mode === "final" ? mode : SETTINGS_DEFAULTS.markdown.mermaid;
  }
}
