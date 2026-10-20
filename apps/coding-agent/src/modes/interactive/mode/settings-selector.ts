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
    const defaultProvider = this.mode.settingsManager.getDefaultProvider();
    const defaultModelId = this.mode.settingsManager.getDefaultModel();
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
      cacheWarmingMode: this.mode.settingsManager.getCacheWarmingMode(),
      currentModel: this.mode.session.model,
      defaultModel: this.defaultModelLabel(),
      defaultProjectTrust: this.mode.settingsManager.getDefaultProjectTrust(),
      enableInstallTelemetry: this.mode.settingsManager.getEnableInstallTelemetry(),
      followUpMode: this.mode.session.run.queue.followUpMode,
      httpIdleTimeoutMs: this.mode.settingsManager.getHttpIdleTimeoutMs(),
      modelThinkingLevels: this.mode.settingsManager.getAllModelThinkingLevels(),
      steeringMode: this.mode.session.run.queue.steeringMode,
      thinkingLevel: this.mode.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
      transport: this.mode.settingsManager.getTransport(),
      treeFilterMode: this.mode.settingsManager.getTreeFilterMode(),
    } satisfies Partial<settingsSelectorTypes.SettingsConfig>;
  }

  private displaySettings() {
    return {
      autoResizeImages: this.mode.settingsManager.getImageAutoResize(),
      autocompleteMaxVisible: this.mode.settingsManager.getAutocompleteMaxVisible(),
      availableThemes: getAvailableThemes(),
      blockImages: this.mode.settingsManager.getBlockImages(),
      collapseChangelog: this.mode.settingsManager.getCollapseChangelog(),
      currentTheme:
        this.mode.display.theme.themeController.getThemeSelection() || SYSTEM_THEME_NAME,
      doubleEscapeAction: this.mode.settingsManager.getDoubleEscapeAction(),
      editorPaddingX: this.mode.settingsManager.getEditorPaddingX(),
      enableSkillCommands: this.mode.settingsManager.getEnableSkillCommands(),
      hideThinkingBlock: this.mode.display.thinking.hideThinkingBlock,
      imageWidthCells: this.mode.settingsManager.getImageWidthCells(),
      mermaidRenderingMode: this.mode.settingsManager.getMermaidRenderingMode(),
      outputPad: this.mode.settingsManager.getOutputPad(),
      quietStartup: this.mode.settingsManager.getQuietStartup(),
      showCacheMissNotices: this.mode.settingsManager.getShowCacheMissNotices(),
      showImages: this.mode.settingsManager.getShowImages(),
      terminalTheme: this.mode.display.theme.themeController.getTerminalTheme(),
    } satisfies Partial<settingsSelectorTypes.SettingsConfig>;
  }

  private terminalSettings() {
    return {
      clearOnShrink: this.mode.settingsManager.getClearOnShrink(),
      fullscreenCopyOnSelect: this.mode.settingsManager.getFullscreenCopyOnSelect(),
      fullscreenExitOutput: this.mode.settingsManager.getFullscreenExitOutput(),
      fullscreenScrollbar: this.mode.settingsManager.getFullscreenScrollbar(),
      fullscreenWheelScrollLines: this.mode.settingsManager.getFullscreenWheelScrollLines(),
      showHardwareCursor: this.mode.settingsManager.getShowHardwareCursor(),
      showTerminalProgress: this.mode.settingsManager.getShowTerminalProgress(),
      tuiMode: this.mode.ui.mode,
    } satisfies Partial<settingsSelectorTypes.SettingsConfig>;
  }
}
