import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";

import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import type themeTypes from "../theme/theme.types.ts";
import type SettingsSelectorComponentClass from "./settings-selector.ts";

declare namespace settingsSelectorTypes {
  interface SettingsConfig {
    autoCompact: boolean;
    defaultModel: string;
    currentModel?: aiTypes.Model<any> | undefined;
    availableDefaultModels: readonly aiTypes.Model<any>[];
    showImages: boolean;
    imageWidthCells: number;
    autoResizeImages: boolean;
    blockImages: boolean;
    enableSkillCommands: boolean;
    steeringMode: "all" | "one-at-a-time";
    followUpMode: "all" | "one-at-a-time";
    transport: aiTypes.Transport;
    httpIdleTimeoutMs: number;
    cacheWarmingMode: settingsManagerTypes.CacheWarmingMode;
    thinkingLevel: agentTypes.ThinkingLevel;
    availableThinkingLevels: agentTypes.ThinkingLevel[];
    modelThinkingLevels: Record<string, agentTypes.ThinkingLevel>;
    currentTheme: string;
    terminalTheme: themeTypes.TerminalTheme;
    availableThemes: string[];
    hideThinkingBlock: boolean;
    mermaidRenderingMode: settingsManagerTypes.MermaidRenderingMode;
    showCacheMissNotices: boolean;
    collapseChangelog: boolean;
    enableInstallTelemetry: boolean;
    doubleEscapeAction: "fork" | "tree" | "none";
    treeFilterMode: "default" | "no-tools" | "user-only" | "labeled-only" | "all";
    showHardwareCursor: boolean;
    editorPaddingX: number;
    outputPad: 0 | 1;
    autocompleteMaxVisible: number;
    quietStartup: settingsManagerTypes.QuietStartup;
    defaultProjectTrust: settingsManagerTypes.DefaultProjectTrust;
    clearOnShrink: boolean;
    showTerminalProgress: boolean;
    tuiMode: settingsManagerTypes.TuiMode;
    fullscreenExitOutput: settingsManagerTypes.FullscreenExitOutput;
    fullscreenScrollbar: tuiTypes.ScrollViewScrollbar;
    fullscreenCopyOnSelect: boolean;
    fullscreenWheelScrollLines: tuiTypes.WheelScrollLines;
  }

  interface SettingsCallbacks {
    onAutoCompactChange: (enabled: boolean) => void;
    onShowImagesChange: (enabled: boolean) => void;
    onImageWidthCellsChange: (width: number) => void;
    onAutoResizeImagesChange: (enabled: boolean) => void;
    onBlockImagesChange: (blocked: boolean) => void;
    onEnableSkillCommandsChange: (enabled: boolean) => void;
    onSteeringModeChange: (mode: "all" | "one-at-a-time") => void;
    onFollowUpModeChange: (mode: "all" | "one-at-a-time") => void;
    onTransportChange: (transport: aiTypes.Transport) => void;
    onHttpIdleTimeoutMsChange: (timeoutMs: number) => void;
    onCacheWarmingModeChange: (mode: settingsManagerTypes.CacheWarmingMode) => void;
    onModelThinkingLevelChange: (
      provider: string,
      modelId: string,
      level: agentTypes.ThinkingLevel,
    ) => void;
    onModelThinkingLevelRemove: (provider: string, modelId: string) => void;
    onThemeChange: (theme: string) => void;
    onThemePreview?: (theme: string) => void;
    onHideThinkingBlockChange: (hidden: boolean) => void;
    onMermaidRenderingModeChange: (mode: settingsManagerTypes.MermaidRenderingMode) => void;
    onShowCacheMissNoticesChange: (shown: boolean) => void;
    onCollapseChangelogChange: (collapsed: boolean) => void;
    onEnableInstallTelemetryChange: (enabled: boolean) => void;
    onDoubleEscapeActionChange: (action: "fork" | "tree" | "none") => void;
    onTreeFilterModeChange: (
      mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all",
    ) => void;
    onShowHardwareCursorChange: (enabled: boolean) => void;
    onEditorPaddingXChange: (padding: number) => void;
    onOutputPadChange: (padding: 0 | 1) => void;
    onAutocompleteMaxVisibleChange: (maxVisible: number) => void;
    onQuietStartupChange: (quiet: settingsManagerTypes.QuietStartup) => void;
    onDefaultProjectTrustChange: (
      defaultProjectTrust: settingsManagerTypes.DefaultProjectTrust,
    ) => void;
    onClearOnShrinkChange: (enabled: boolean) => void;
    onShowTerminalProgressChange: (enabled: boolean) => void;
    onTuiModeChange: (mode: settingsManagerTypes.TuiMode) => void;
    onFullscreenExitOutputChange: (output: settingsManagerTypes.FullscreenExitOutput) => void;
    onFullscreenScrollbarChange: (mode: tuiTypes.ScrollViewScrollbar) => void;
    onFullscreenCopyOnSelectChange: (enabled: boolean) => void;
    onFullscreenWheelScrollLinesChange: (lines: tuiTypes.WheelScrollLines) => void;
    onCancel: () => void;
  }

  type SettingsSelectorComponent = (typeof SettingsSelectorComponentClass)["prototype"];

  interface SettingEntry {
    item: tuiTypes.SettingItem;
    apply?: (value: string, callbacks: SettingsCallbacks) => void;
  }
}

export type { settingsSelectorTypes as default };
