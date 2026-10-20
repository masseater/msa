import defaults from "../../core/defaults.ts";
import platformModule from "../../core/platform.ts";
import MemoryView from "./components/memory-view.ts";
import type settingsSelectorTypes from "./components/settings-selector.types.ts";
import type statusIndicatorTypes from "./components/status-indicator.types.ts";
import emptyEnterBurstModule from "./empty-enter-burst.ts";
import interactiveModeHelpers from "./interactive-mode-helpers.ts";
import InteractiveModeLayer7 from "./interactive-mode-layer-7.ts";
import LoginFlow from "./login-flow.ts";
import themeModule from "./theme/theme.ts";

const { registerEmptyEnter } = emptyEnterBurstModule;
const { nowMs, schedule } = platformModule;
const { SYSTEM_THEME_NAME, getAvailableThemes } = themeModule;
const { DEFAULT_THINKING_LEVEL, THINKING_LEVEL_OPTIONS } = defaults;
const { isEmbeddedStatus } = interactiveModeHelpers;

export default abstract class InteractiveModeLayer8 extends InteractiveModeLayer7 {
  protected createLoginFlow() {
    const getSession = () => this.session;
    return new LoginFlow({
      editorSlot: this.editorSlot,
      programStatus: this.programStatus,
      refreshAuthState: () => {
        this.updateAvailableProviderCount();
        this.footer.invalidate();
        this.updateEditorBorderColor();
      },
      get session() {
        return getSession();
      },
      showError: (message) => this.showError(message),
      showStatus: (message) => this.showStatus(message),
      showWarning: (message) => this.showWarning(message),
      ui: this.ui,
    });
  }

  protected setEditorWorkingStatusIndicator(
    indicator: statusIndicatorTypes.StatusIndicator | undefined,
  ): boolean {
    this.defaultEditor.setWorkingStatusIndicator(undefined);
    if (!isEmbeddedStatus(this.editor)) return false;
    this.editor.setWorkingStatusIndicator(indicator);
    return true;
  }

  protected showStatusIndicator(indicator: statusIndicatorTypes.StatusIndicator): void {
    this.activeStatusIndicator?.dispose();
    this.activeStatusIndicator = indicator;
    this.activeWorkingIndicatorEmbedded = false;
    this.statusContainer.clear();
    this.setEditorWorkingStatusIndicator(undefined);
    if (this.setEditorWorkingStatusIndicator(indicator)) {
      this.activeWorkingIndicatorEmbedded = true;
      return;
    }
    this.statusContainer.addChild(indicator);
  }

  protected clearStatusIndicator(kind?: statusIndicatorTypes.StatusIndicator["kind"]): void {
    if (kind !== undefined && this.activeStatusIndicator?.kind !== kind) {
      return;
    }
    const clearedIndicator = this.activeStatusIndicator;
    const clearedIndicatorWasEmbedded = this.activeWorkingIndicatorEmbedded;
    clearedIndicator?.dispose();
    this.activeStatusIndicator = undefined;
    this.activeWorkingIndicatorEmbedded = false;
    this.statusContainer.clear();
    this.setEditorWorkingStatusIndicator(undefined);
    if (
      clearedIndicator !== undefined &&
      !clearedIndicatorWasEmbedded &&
      this.options.tuiMode === "regular" &&
      this.ui.getClearOnShrink()
    ) {
      this.statusContainer.addChild(this.idleStatus);
    }
  }

  protected handleEmptyEnter(): void {
    const { burst, fire } = registerEmptyEnter(this.emptyEnterBurst, nowMs());
    this.emptyEnterBurst = burst;
    if (!fire) return;
    const sent = this.session.run.queue.flushQueue();
    if (sent === 0) return;
    this.showStatus(`Sent ${sent} queued message${sent > 1 ? "s" : ""}`);
  }

  protected onAgentEnd(): void {
    if (this.settingsManager.getShowTerminalProgress()) this.ui.terminal.setProgress(false);
    this.clearStatusIndicator("working");
    if (this.streamingComponent !== undefined) {
      this.chatContainer.removeChild(this.streamingComponent);
      this.toolGroup?.items.removeChild(this.streamingComponent);
      const thinking = this.streamingComponent.takenThinking;
      if (thinking !== undefined) this.toolGroup?.items.removeChild(thinking);
      this.streamingComponent = undefined;
      this.streamingMessage = undefined;
    }
    this.pendingTools.clear();
    this.ui.requestRender();
  }

  protected handleEventPart4(): void {
    if (this.settingsManager.getShowTerminalProgress()) {
      this.ui.terminal.setProgress(false);
    }
    if (this.autoCompactionEscapeHandler !== undefined) {
      this.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
      this.autoCompactionEscapeHandler = undefined;
    }
    this.clearStatusIndicator("compaction");
  }

  protected handleCtrlZ(): void {
    if (process.platform === "win32") {
      this.showStatus("Suspend to background is not supported on Windows");
      return;
    }

    const suspendKeepAlive = schedule(() => {}, 2 ** 30);

    const ignoreSigint = () => {};
    process.on("SIGINT", ignoreSigint);

    process.once("SIGCONT", () => {
      suspendKeepAlive.cancel();
      process.removeListener("SIGINT", ignoreSigint);
      this.ui.start();
      this.ui.requestRender(true);
    });

    try {
      this.ui.stop();

      process.kill(0, "SIGTSTP");
    } catch (error) {
      suspendKeepAlive.cancel();
      process.removeListener("SIGINT", ignoreSigint);
      throw error;
    }
  }

  protected settingsConfigDisplay() {
    const { defaultModel } = this.showSettingsSelectorSelector();
    return {
      autoCompact: this.session.compaction.auto.autoCompactionEnabled,
      autoResizeImages: this.settingsManager.getImageAutoResize(),
      autocompleteMaxVisible: this.settingsManager.getAutocompleteMaxVisible(),
      availableDefaultModels: this.session.models.selection.modelRuntime.getAvailableSnapshot(),
      availableThemes: getAvailableThemes(),
      availableThinkingLevels: [...THINKING_LEVEL_OPTIONS],
      blockImages: this.settingsManager.getBlockImages(),
      cacheWarmingMode: this.settingsManager.getCacheWarmingMode(),
      clearOnShrink: this.settingsManager.getClearOnShrink(),
      collapseChangelog: this.settingsManager.getCollapseChangelog(),
      currentModel: this.session.model,
      currentTheme: this.themeController.getThemeSelection() || SYSTEM_THEME_NAME,
      defaultModel,
      defaultProjectTrust: this.settingsManager.getDefaultProjectTrust(),
      doubleEscapeAction: this.settingsManager.getDoubleEscapeAction(),
      editorPaddingX: this.settingsManager.getEditorPaddingX(),
      enableInstallTelemetry: this.settingsManager.getEnableInstallTelemetry(),
      enableSkillCommands: this.settingsManager.getEnableSkillCommands(),
      followUpMode: this.session.run.queue.followUpMode,
      fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
    } satisfies Partial<settingsSelectorTypes.SettingsConfig>;
  }

  protected settingsConfigBehavior() {
    return {
      fullscreenExitOutput: this.settingsManager.getFullscreenExitOutput(),
      fullscreenScrollbar: this.settingsManager.getFullscreenScrollbar(),
      fullscreenWheelScrollLines: this.settingsManager.getFullscreenWheelScrollLines(),
      hideThinkingBlock: this.hideThinkingBlock,
      httpIdleTimeoutMs: this.settingsManager.getHttpIdleTimeoutMs(),
      imageWidthCells: this.settingsManager.getImageWidthCells(),
      mermaidRenderingMode: this.settingsManager.getMermaidRenderingMode(),
      modelThinkingLevels: this.settingsManager.getAllModelThinkingLevels(),
      outputPad: this.settingsManager.getOutputPad(),
      quietStartup: this.settingsManager.getQuietStartup(),
      showCacheMissNotices: this.settingsManager.getShowCacheMissNotices(),
      showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
      showImages: this.settingsManager.getShowImages(),
      showTerminalProgress: this.settingsManager.getShowTerminalProgress(),
      steeringMode: this.session.run.queue.steeringMode,
      terminalTheme: this.themeController.getTerminalTheme(),
      thinkingLevel: this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
      transport: this.settingsManager.getTransport(),
      treeFilterMode: this.settingsManager.getTreeFilterMode(),
      tuiMode: this.ui.mode,
    } satisfies Partial<settingsSelectorTypes.SettingsConfig>;
  }

  protected settingsCallbacks1(done: () => void) {
    return {
      onAutoCompactChange: (enabled) => {
        this.session.compaction.auto.setAutoCompactionEnabled(enabled);
        this.footer.setAutoCompactEnabled(enabled);
      },
      onAutoResizeImagesChange: (enabled) => {
        this.settingsManager.setImageAutoResize(enabled);
      },
      onAutocompleteMaxVisibleChange: (maxVisible) => {
        this.settingsManager.setAutocompleteMaxVisible(maxVisible);
        this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
        if (
          this.editor !== this.defaultEditor &&
          this.editor.setAutocompleteMaxVisible !== undefined
        ) {
          this.editor.setAutocompleteMaxVisible(maxVisible);
        }
      },
      onBlockImagesChange: (blocked) => {
        this.settingsManager.setBlockImages(blocked);
      },
      onCacheWarmingModeChange: (mode) => {
        this.session.models.cacheWarming.setCacheWarmingMode(mode);
        this.showStatus(`Cache warming: ${mode}`);
      },
      onCancel: () => {
        done();
        this.ui.requestRender();
      },
      onClearOnShrinkChange: (enabled) => {
        this.settingsManager.setClearOnShrink(enabled);
        this.ui.setClearOnShrink(enabled);
        if (!enabled && this.activeStatusIndicator === undefined) {
          this.statusContainer.clear();
        }
      },
      onCollapseChangelogChange: (collapsed) => {
        this.settingsManager.setCollapseChangelog(collapsed);
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  protected showMemoryView(): void {
    const memory = this.session.integrations.memory.memory;
    if (memory === undefined) {
      this.showStatus("Memory is disabled (settings: memory.enabled)");
      return;
    }
    this.editorSlot.showSelector((done) => {
      const view = new MemoryView({
        confirm: (message) => this.extensionDialogs.confirm("Forget memory", message),
        maxHeight: () => this.ui.terminal.rows - 4,
        onClose: () => {
          done();
          this.ui.requestRender();
        },
        onError: (message) => this.showError(message),
        requestRender: () => this.ui.requestRender(),
        service: memory,
      });
      return { component: view, focus: view };
    });
  }
}
