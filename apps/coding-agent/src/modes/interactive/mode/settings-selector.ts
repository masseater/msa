import defaults from "../../../core/defaults.ts";
import SettingsSelectorComponent from "../components/settings-selector.ts";
import type settingsSelectorTypes from "../components/settings-selector.types.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { SYSTEM_THEME_NAME, getAvailableThemes } = themeModule;
const { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } = defaults;

export default class SettingsSelector {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  showSettingsSelector(): void {
    const callbacks = this.mode.selectors.settingsCallbacks;
    this.mode.editorSlot.showSelector((done) => {
      let selector: settingsSelectorTypes.SettingsSelectorComponent | undefined;
      selector = new SettingsSelectorComponent(
        { ...this.modelSettings(), ...this.displaySettings(), ...this.terminalSettings() },
        {
          ...callbacks.modelCallbacks(),
          ...callbacks.sessionCallbacks(),
          ...callbacks.editorCallbacks(),
          ...callbacks.imageCallbacks(),
          ...callbacks.transcriptCallbacks(),
          ...callbacks.terminalCallbacks(() => selector),
          onCancel: () => {
            done();
            this.mode.ui.requestRender();
          },
        },
      );
      return { component: selector, focus: selector.getSettingsList() };
    });
  }

  private defaultModelLabel(): string {
    const defaultProvider = this.mode.settingsManager.models.getDefaultProvider();
    const defaultModelId = this.mode.settingsManager.models.getDefaultModel();
    return defaultProvider !== undefined &&
      defaultProvider !== "" &&
      defaultModelId !== undefined &&
      defaultModelId !== ""
      ? `${defaultProvider}/${defaultModelId}`
      : "not set";
  }

  private modelSettings() {
    return {
      autoCompact: this.mode.session.compaction.auto.autoCompactionEnabled,
      availableDefaultModels:
        this.mode.session.models.selection.modelRuntime.getAvailableSnapshot(),
      availableThinkingLevels: [...THINKING_LEVEL_OPTIONS],
      cacheWarmingMode: this.mode.settingsManager.session.getCacheWarmingMode(),
      currentModel: this.mode.session.model,
      defaultModel: this.defaultModelLabel(),
      defaultProjectTrust: this.mode.settingsManager.session.getDefaultProjectTrust(),
      enableInstallTelemetry: this.mode.settingsManager.telemetry.getEnableInstallTelemetry(),
      followUpMode: this.mode.session.run.queue.followUpMode,
      httpIdleTimeoutMs: this.mode.settingsManager.session.getHttpIdleTimeoutMs(),
      modelThinkingLevels: this.mode.settingsManager.models.getAllModelThinkingLevels(),
      steeringMode: this.mode.session.run.queue.steeringMode,
      thinkingLevel:
        this.mode.settingsManager.models.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
      transport: this.mode.settingsManager.models.getTransport(),
      treeFilterMode: this.mode.settingsManager.terminal.getTreeFilterMode(),
    } satisfies Partial<settingsSelectorTypes.SettingsConfig>;
  }

  private displaySettings() {
    return {
      autoResizeImages: this.mode.settingsManager.display.getImageAutoResize(),
      autocompleteMaxVisible: this.mode.settingsManager.terminal.getAutocompleteMaxVisible(),
      availableThemes: getAvailableThemes(),
      blockImages: this.mode.settingsManager.display.getBlockImages(),
      collapseChangelog: this.mode.settingsManager.display.getCollapseChangelog(),
      currentTheme:
        this.mode.display.theme.themeController.getThemeSelection() || SYSTEM_THEME_NAME,
      doubleEscapeAction: this.mode.settingsManager.terminal.getDoubleEscapeAction(),
      editorPaddingX: this.mode.settingsManager.terminal.getEditorPaddingX(),
      enableSkillCommands: this.mode.settingsManager.resources.getEnableSkillCommands(),
      hideThinkingBlock: this.mode.display.thinking.hideThinkingBlock,
      imageWidthCells: this.mode.settingsManager.display.getImageWidthCells(),
      mermaidRenderingMode: this.mode.settingsManager.display.getMermaidRenderingMode(),
      outputPad: this.mode.settingsManager.terminal.getOutputPad(),
      quietStartup: this.mode.settingsManager.display.getQuietStartup(),
      showCacheMissNotices: this.mode.settingsManager.display.getShowCacheMissNotices(),
      showImages: this.mode.settingsManager.display.getShowImages(),
      terminalTheme: this.mode.display.theme.themeController.getTerminalTheme(),
    } satisfies Partial<settingsSelectorTypes.SettingsConfig>;
  }

  private terminalSettings() {
    return {
      clearOnShrink: this.mode.settingsManager.terminal.getClearOnShrink(),
      fullscreenCopyOnSelect: this.mode.settingsManager.terminal.getFullscreenCopyOnSelect(),
      fullscreenExitOutput: this.mode.settingsManager.terminal.getFullscreenExitOutput(),
      fullscreenScrollbar: this.mode.settingsManager.terminal.getFullscreenScrollbar(),
      fullscreenWheelScrollLines:
        this.mode.settingsManager.terminal.getFullscreenWheelScrollLines(),
      showHardwareCursor: this.mode.settingsManager.terminal.getShowHardwareCursor(),
      showTerminalProgress: this.mode.settingsManager.terminal.getShowTerminalProgress(),
      tuiMode: this.mode.ui.mode,
    } satisfies Partial<settingsSelectorTypes.SettingsConfig>;
  }
}
