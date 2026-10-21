import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import config from "../../../config.ts";
import httpDispatcher from "../../../core/http-dispatcher.ts";
import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import imageConvert from "../../../utils/image-convert.ts";
import type InteractiveMode from "../interactive-mode.ts";
import type interactiveModeTypes from "../interactive-mode.types.ts";
import tuiRenderer from "../tui-renderer.ts";

const { ensurePngTranscoder } = imageConvert;
const { getAgentDir } = config;
const { TuiAltScreen, setCapabilityOverrides, TuiMainScreen } = tuiModule;
const { configureHttpDispatcher } = httpDispatcher;
const { createInteractiveTui, createInteractiveTuiReference } = tuiRenderer;

export default class ScreenRenderer {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  renderer!: tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen;

  private mainScreenRenderState!: tuiTypes.TuiMainScreenRenderState | undefined;

  applyFullscreenScrollbarSetting(): void {
    this.mode.layout.transcriptScrollView?.setScrollbar(
      this.mode.settingsManager.terminal.getFullscreenScrollbar(),
    );
  }

  ensurePngTranscoder(): void {
    ensurePngTranscoder(() => {
      this.mode.ui.invalidate();
      this.mode.ui.requestRender();
    });
  }

  mountInteractiveTui(
    tui: tuiTypes.TuiMainScreen | tuiTypes.TuiAltScreen,
    components: readonly tuiTypes.Component[],
  ): void {
    for (const component of components) tui.addChild(component);
    if (tuiModule.isViewportTUI(tui)) {
      if (this.mode.layout.fullscreenLayoutRoot === undefined)
        throw new Error("Fullscreen layout is not initialized");
      tui.setLayoutRoot(this.mode.layout.fullscreenLayoutRoot);
    }
  }

  applyRuntimeSettings(): void {
    setCapabilityOverrides(this.mode.settingsManager.terminal.getTerminalCapabilityOverrides());
    this.ensurePngTranscoder();
    configureHttpDispatcher(this.mode.settingsManager.session.getHttpIdleTimeoutMs());
    this.applyFullscreenScrollbarSetting();
    if (this.renderer instanceof TuiAltScreen) {
      this.renderer.setCopyOnSelect(this.mode.settingsManager.terminal.getFullscreenCopyOnSelect());
      this.renderer.setWheelScrollLines(
        this.mode.settingsManager.terminal.getFullscreenWheelScrollLines(),
      );
    }
    this.mode.footer.setSession(this.mode.session);
    this.mode.lifecycle.events.updateGoalTicker();
    void this.mode.session.integrations.orchestration.orchestrator?.refresh();
    this.mode.footer.setAutoCompactEnabled(this.mode.session.compaction.auto.autoCompactionEnabled);
    this.mode.layout.footerDataProvider.setCwd(this.mode.sessionManager.getCwd());
    this.mode.display.thinking.hideThinkingBlock =
      this.mode.settingsManager.display.getHideThinkingBlock();
    this.mode.display.thinking.outputPad = this.mode.settingsManager.terminal.getOutputPad();
    this.mode.ui.setShowHardwareCursor(this.mode.settingsManager.terminal.getShowHardwareCursor());
    const clearOnShrink = this.mode.settingsManager.terminal.getClearOnShrink();
    this.mode.ui.setClearOnShrink(clearOnShrink);
    if (!clearOnShrink && this.mode.display.indicator.activeStatusIndicator === undefined) {
      this.mode.layout.statusContainer.clear();
    }
    const editorPaddingX = this.mode.settingsManager.terminal.getEditorPaddingX();
    const autocompleteMaxVisible = this.mode.settingsManager.terminal.getAutocompleteMaxVisible();
    this.mode.defaultEditor.setPaddingX(editorPaddingX);
    this.mode.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
    if (this.mode.editor !== this.mode.defaultEditor) {
      this.mode.editor.setPaddingX?.(editorPaddingX);
      this.mode.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
    }
  }

  resolveOptions(
    options: interactiveModeTypes.InteractiveModeOptions,
  ): interactiveModeTypes.InteractiveModeOptions {
    const settings = this.mode.settingsManager;
    setCapabilityOverrides(settings.terminal.getTerminalCapabilityOverrides());
    return { ...options, tuiMode: options.tuiMode ?? settings.terminal.getTuiMode() };
  }

  createUi(): tuiTypes.TUI {
    const { options, settingsManager } = this.mode;
    this.renderer = this.createRenderer(options.terminal, options.tuiMode ?? "regular");
    const ui = createInteractiveTuiReference(() => this.renderer);
    ui.setClearOnShrink(settingsManager.terminal.getClearOnShrink());
    return ui;
  }

  private createRenderer(
    terminal: interactiveModeTypes.InteractiveModeOptions["terminal"],
    tuiMode: NonNullable<interactiveModeTypes.InteractiveModeOptions["tuiMode"]>,
  ) {
    return createInteractiveTui({
      fullscreenCopyOnSelect: this.mode.settingsManager.terminal.getFullscreenCopyOnSelect(),
      fullscreenWheelScrollLines:
        this.mode.settingsManager.terminal.getFullscreenWheelScrollLines(),
      logDirectory: getAgentDir(),
      onRightClickPaste: this.mode.input.clipboard.onRightClickPaste,
      showHardwareCursor: this.mode.settingsManager.terminal.getShowHardwareCursor(),
      terminal,
      tuiMode,
    });
  }

  stopInteractiveTui(fullscreenExitOutput: settingsManagerTypes.FullscreenExitOutput): void {
    if (this.renderer.mode === "fullscreen" && fullscreenExitOutput === "transcript") {
      while (this.renderer.hasOverlayEntries) this.renderer.hideOverlay();
      this.switchTuiMode("regular", false, false);
      this.renderer.renderNow();
    }
    this.mode.ui.stop({ preserveScreen: this.renderer.mode === "fullscreen" });
  }

  switchTuiMode(
    mode: settingsManagerTypes.TuiMode,
    restoreProgress = true,
    startRenderer = true,
  ): boolean {
    const switchTuiModeTerminalResult = this.replaceTuiRenderer(mode, startRenderer);
    if (switchTuiModeTerminalResult.done) return switchTuiModeTerminalResult.value;
    const terminal = switchTuiModeTerminalResult.value;
    this.mode.extensions.dialogs.rebindExtensionTerminalInputListeners();
    if (
      restoreProgress &&
      this.mode.settingsManager.terminal.getShowTerminalProgress() &&
      (this.mode.session.isStreaming || this.mode.session.compaction.manual.isCompacting)
    ) {
      terminal.setProgress(true);
    }
    return true;
  }

  private replaceTuiRenderer(
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
      fullscreenCopyOnSelect: this.mode.settingsManager.terminal.getFullscreenCopyOnSelect(),
      fullscreenWheelScrollLines:
        this.mode.settingsManager.terminal.getFullscreenWheelScrollLines(),
      logDirectory: getAgentDir(),
      onRightClickPaste: this.mode.input.clipboard.onRightClickPaste,
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
    this.mode.options.tuiMode = mode;
    this.mountInteractiveTui(nextUi, components);
    nextUi.invalidate();
    nextUi.setFocus(focus);
    if (!startRenderer) return { done: true, value: true };
    nextUi.start();
    this.mode.display.theme.themeController.rebindTui();
    return { done: false, value: terminal };
  }
}
