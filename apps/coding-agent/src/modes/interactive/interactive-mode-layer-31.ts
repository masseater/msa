import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import config from "../../config.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import type settingsSelectorTypes from "./components/settings-selector.types.ts";
import ToolExecutionComponent from "./components/tool-execution.ts";
import InteractiveModeLayer30 from "./interactive-mode-layer-30.ts";
import tuiRenderer from "./tui-renderer.ts";

const { TuiMainScreen } = tuiModule;
const { createInteractiveTui } = tuiRenderer;
const { getAgentDir } = config;

export default abstract class InteractiveModeLayer31 extends InteractiveModeLayer30 {
  protected stopInteractiveTui(
    fullscreenExitOutput: settingsManagerTypes.FullscreenExitOutput,
  ): void {
    if (this.renderer.mode === "fullscreen" && fullscreenExitOutput === "transcript") {
      while (this.renderer.hasOverlayEntries) this.renderer.hideOverlay();
      this.switchTuiMode("regular", false, false);
      this.renderer.renderNow();
    }
    this.ui.stop({ preserveScreen: this.renderer.mode === "fullscreen" });
  }

  protected switchTuiMode(
    mode: settingsManagerTypes.TuiMode,
    restoreProgress = true,
    startRenderer = true,
  ): boolean {
    const switchTuiModeTerminalResult = this.switchTuiModeTerminal(mode, startRenderer);
    if (switchTuiModeTerminalResult.done) return switchTuiModeTerminalResult.value;
    const terminal = switchTuiModeTerminalResult.value;
    this.rebindExtensionTerminalInputListeners();
    if (
      restoreProgress &&
      this.settingsManager.getShowTerminalProgress() &&
      (this.session.isStreaming || this.session.isCompacting)
    ) {
      terminal.setProgress(true);
    }
    return true;
  }

  protected switchTuiModeTerminal(
    mode: settingsManagerTypes.TuiMode,
    startRenderer: boolean,
  ): { done: true; value: boolean } | { done: false; value: tuiTypes.Terminal } {
    const previousUi = this.renderer;
    if (mode === previousUi.mode) return { done: true, value: true };
    if (previousUi.hasOverlayEntries) return { done: true, value: false };

    const components = [...previousUi.children];
    const focus = previousUi.getFocusedComponent();
    const terminal = previousUi.terminal;
    const showHardwareCursor = previousUi.getShowHardwareCursor();
    const clearOnShrink = previousUi.getClearOnShrink();
    const onDebug = previousUi.onDebug;
    if (previousUi instanceof TuiMainScreen) {
      this.mainScreenRenderState = previousUi.captureRenderState();
    }

    previousUi.stop({ preserveScreen: true });
    previousUi.setFocus(null);
    previousUi.clear();
    if (tuiModule.isViewportTUI(previousUi)) previousUi.setLayoutRoot(undefined);

    const nextUi = createInteractiveTui({
      fullscreenCopyOnSelect: this.settingsManager.getFullscreenCopyOnSelect(),
      fullscreenWheelScrollLines: this.settingsManager.getFullscreenWheelScrollLines(),
      logDirectory: getAgentDir(),
      onRightClickPaste: this.onRightClickPaste,
      showHardwareCursor,
      terminal,
      tuiMode: mode,
    });
    nextUi.setClearOnShrink(clearOnShrink);
    if (onDebug !== undefined) nextUi.onDebug = onDebug;
    if (nextUi instanceof TuiMainScreen && this.mainScreenRenderState !== undefined) {
      nextUi.restoreRenderState(this.mainScreenRenderState);
    }
    this.renderer = nextUi;
    this.options.tuiMode = mode;
    this.mountInteractiveTui(nextUi, components);
    nextUi.invalidate();
    nextUi.setFocus(focus);
    if (!startRenderer) return { done: true, value: true };
    nextUi.start();
    this.themeController.rebindTui();
    return { done: false, value: terminal };
  }

  protected settingsCallbacks5(
    getSelector: () => settingsSelectorTypes.SettingsSelectorComponent | undefined,
  ) {
    return {
      onShowImagesChange: (enabled) => {
        this.settingsManager.setShowImages(enabled);
        for (const child of this.chatComponents()) {
          if (child instanceof ToolExecutionComponent) {
            child.setShowImages(enabled);
          }
        }
      },
      onShowTerminalProgressChange: (enabled) => {
        this.settingsManager.setShowTerminalProgress(enabled);
      },
      onSteeringModeChange: (mode) => {
        this.session.setSteeringMode(mode);
      },
      onThemeChange: (themeSetting) => {
        this.settingsManager.setTheme(themeSetting);
        this.themeController.setThemeSetting(themeSetting);
      },
      onThemePreview: (themeName) => this.themeController.preview(themeName),
      onTransportChange: (transport) => {
        this.settingsManager.setTransport(transport);
        this.session.agent.transport = transport;
      },
      onTreeFilterModeChange: (mode) => {
        this.settingsManager.setTreeFilterMode(mode);
      },
      onTuiModeChange: (mode) => {
        if (!this.switchTuiMode(mode)) {
          getSelector()?.getSettingsList().updateValue("tui-mode", this.ui.mode);
          this.showStatus("Close active overlays before changing TUI mode");
          return;
        }
        this.settingsManager.setTuiMode(mode);
        if (this.activeStatusIndicator === undefined) this.statusContainer.clear();
        this.showStatus(`TUI mode: ${mode}`);
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  stop(fullscreenExitOutput = this.settingsManager.getFullscreenExitOutput()): void {
    this.editorSlot.disposeActiveSelector();
    if (this.settingsManager.getShowTerminalProgress()) {
      this.ui.terminal.setProgress(false);
    }
    this.clearStatusIndicator();
    this.themeController.disableAutoSync();
    this.clearExtensionTerminalInputListeners();
    this.footer.dispose();
    this.footerDataProvider.dispose();
    if (this.goalTicker !== undefined) this.goalTicker.cancel();
    this.goalTicker = undefined;
    if (this.unsubscribe !== undefined) {
      this.unsubscribe();
    }
    if (this.isInitialized) {
      this.stopInteractiveTui(fullscreenExitOutput);
      this.isInitialized = false;
    }
    this.unregisterSignalHandlers();
  }
}
