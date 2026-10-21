import tuiModule from "@msa/tui";

import defaults from "../../../core/defaults.ts";
import httpDispatcher from "../../../core/http-dispatcher.ts";
import type settingsSelectorTypes from "../components/settings-selector.types.ts";
import ToolExecutionComponent from "../components/tool-execution.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { TuiAltScreen } = tuiModule;
const { DEFAULT_THINKING_LEVEL } = defaults;
const { configureHttpDispatcher, formatHttpIdleTimeoutMs } = httpDispatcher;

export default class SettingsCallbacks {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  modelCallbacks() {
    return {
      onHttpIdleTimeoutMsChange: (timeoutMs) => {
        this.mode.settingsManager.session.setHttpIdleTimeoutMs(timeoutMs);
        configureHttpDispatcher(timeoutMs);
        this.mode.display.status.showStatus(
          `HTTP idle timeout: ${formatHttpIdleTimeoutMs(timeoutMs)}`,
        );
      },
      onModelThinkingLevelChange: (provider, modelId, level) => {
        this.mode.settingsManager.models.setModelThinkingLevel(provider, modelId, level);
        const current = this.mode.session.model;
        if (current !== undefined && current.provider === provider && current.id === modelId) {
          this.mode.session.models.thinking.setThinkingLevel(level);
          this.mode.footer.invalidate();
          this.mode.input.keys.updateEditorBorderColor();
        }
      },
      onModelThinkingLevelRemove: (provider, modelId) => {
        this.mode.settingsManager.models.removeModelThinkingLevel(provider, modelId);
        const current = this.mode.session.model;
        if (current !== undefined && current.provider === provider && current.id === modelId) {
          const globalDefault =
            this.mode.settingsManager.models.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
          this.mode.session.models.thinking.setThinkingLevel(globalDefault);
          this.mode.footer.invalidate();
          this.mode.input.keys.updateEditorBorderColor();
        }
      },
      onTransportChange: (transport) => {
        this.mode.settingsManager.models.setTransport(transport);
        this.mode.session.agent.transport = transport;
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  sessionCallbacks() {
    return {
      onAutoCompactChange: (enabled) => {
        this.mode.session.compaction.auto.setAutoCompactionEnabled(enabled);
        this.mode.footer.setAutoCompactEnabled(enabled);
      },
      onCacheWarmingModeChange: (mode) => {
        this.mode.session.models.cacheWarming.setCacheWarmingMode(mode);
        this.mode.display.status.showStatus(`Cache warming: ${mode}`);
      },
      onDefaultProjectTrustChange: (defaultProjectTrust) => {
        this.mode.settingsManager.session.setDefaultProjectTrust(defaultProjectTrust);
      },
      onEnableInstallTelemetryChange: (enabled) => {
        this.mode.settingsManager.telemetry.setEnableInstallTelemetry(enabled);
      },
      onFollowUpModeChange: (mode) => {
        this.mode.session.run.queue.setFollowUpMode(mode);
      },
      onSteeringModeChange: (mode) => {
        this.mode.session.run.queue.setSteeringMode(mode);
      },
      onTreeFilterModeChange: (mode) => {
        this.mode.settingsManager.terminal.setTreeFilterMode(mode);
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  editorCallbacks() {
    return {
      onAutocompleteMaxVisibleChange: (maxVisible) => {
        this.mode.settingsManager.terminal.setAutocompleteMaxVisible(maxVisible);
        this.mode.defaultEditor.setAutocompleteMaxVisible(maxVisible);
        if (
          this.mode.editor !== this.mode.defaultEditor &&
          this.mode.editor.setAutocompleteMaxVisible !== undefined
        ) {
          this.mode.editor.setAutocompleteMaxVisible(maxVisible);
        }
      },
      onDoubleEscapeActionChange: (action) => {
        this.mode.settingsManager.terminal.setDoubleEscapeAction(action);
      },
      onEditorPaddingXChange: (padding) => {
        this.mode.settingsManager.terminal.setEditorPaddingX(padding);
        this.mode.defaultEditor.setPaddingX(padding);
        if (
          this.mode.editor !== this.mode.defaultEditor &&
          this.mode.editor.setPaddingX !== undefined
        ) {
          this.mode.editor.setPaddingX(padding);
        }
      },
      onEnableSkillCommandsChange: (enabled) => {
        this.mode.settingsManager.resources.setEnableSkillCommands(enabled);
        this.mode.input.autocomplete.setupAutocompleteProvider();
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  imageCallbacks() {
    return {
      onAutoResizeImagesChange: (enabled) => {
        this.mode.settingsManager.display.setImageAutoResize(enabled);
      },
      onBlockImagesChange: (blocked) => {
        this.mode.settingsManager.display.setBlockImages(blocked);
      },
      onImageWidthCellsChange: (width) => {
        this.mode.settingsManager.display.setImageWidthCells(width);
        for (const child of this.mode.view.toolExecutions.chatComponents()) {
          if (child instanceof ToolExecutionComponent) {
            child.setImageWidthCells(width);
          }
        }
      },
      onShowImagesChange: (enabled) => {
        this.mode.settingsManager.display.setShowImages(enabled);
        for (const child of this.mode.view.toolExecutions.chatComponents()) {
          if (child instanceof ToolExecutionComponent) {
            child.setShowImages(enabled);
          }
        }
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  transcriptCallbacks() {
    return {
      onCollapseChangelogChange: (collapsed) => {
        this.mode.settingsManager.display.setCollapseChangelog(collapsed);
      },
      onHideThinkingBlockChange: (hidden) => {
        this.mode.display.thinking.hideThinkingBlock = hidden;
        this.mode.settingsManager.display.setHideThinkingBlock(hidden);
        this.mode.display.thinking.updateThinkingBlockVisibility();
      },
      onMermaidRenderingModeChange: (mode) => {
        this.mode.settingsManager.display.setMermaidRenderingMode(mode);
        this.mode.layout.chatContainer.invalidate();
        this.mode.ui.requestRender();
      },
      onOutputPadChange: (padding) => {
        this.mode.settingsManager.terminal.setOutputPad(padding);
        this.mode.display.thinking.outputPad = padding;
        for (const children of [
          this.mode.view.toolExecutions.chatComponents(),
          this.mode.layout.pendingMessagesContainer.children,
        ]) {
          for (const child of children) {
            if ("setOutputPad" in child && typeof child.setOutputPad === "function") {
              child.setOutputPad(padding);
            }
          }
        }
        this.mode.ui.requestRender();
      },
      onQuietStartupChange: (quiet) => {
        this.mode.settingsManager.display.setQuietStartup(quiet);
      },
      onShowCacheMissNoticesChange: (shown) => {
        this.mode.settingsManager.display.setShowCacheMissNotices(shown);
        this.mode.view.history.rebuildChatFromMessages();
      },
      onThemeChange: (themeSetting) => {
        this.mode.settingsManager.display.setTheme(themeSetting);
        this.mode.display.theme.themeController.setThemeSetting(themeSetting);
      },
      onThemePreview: (themeName) => this.mode.display.theme.themeController.preview(themeName),
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }

  terminalCallbacks(
    getSelector: () => settingsSelectorTypes.SettingsSelectorComponent | undefined,
  ) {
    return {
      onClearOnShrinkChange: (enabled) => {
        this.mode.settingsManager.terminal.setClearOnShrink(enabled);
        this.mode.ui.setClearOnShrink(enabled);
        if (!enabled && this.mode.display.indicator.activeStatusIndicator === undefined) {
          this.mode.layout.statusContainer.clear();
        }
      },
      onFullscreenCopyOnSelectChange: (enabled) => {
        this.mode.settingsManager.terminal.setFullscreenCopyOnSelect(enabled);
        if (this.mode.lifecycle.screen.renderer instanceof TuiAltScreen)
          this.mode.lifecycle.screen.renderer.setCopyOnSelect(enabled);
      },
      onFullscreenExitOutputChange: (output) => {
        this.mode.settingsManager.terminal.setFullscreenExitOutput(output);
      },
      onFullscreenScrollbarChange: (mode) => {
        this.mode.settingsManager.terminal.setFullscreenScrollbar(mode);
        this.mode.lifecycle.screen.applyFullscreenScrollbarSetting();
      },
      onFullscreenWheelScrollLinesChange: (lines) => {
        this.mode.settingsManager.terminal.setFullscreenWheelScrollLines(lines);
        if (this.mode.lifecycle.screen.renderer instanceof TuiAltScreen)
          this.mode.lifecycle.screen.renderer.setWheelScrollLines(lines);
      },
      onShowHardwareCursorChange: (enabled) => {
        this.mode.settingsManager.terminal.setShowHardwareCursor(enabled);
        this.mode.ui.setShowHardwareCursor(enabled);
      },
      onShowTerminalProgressChange: (enabled) => {
        this.mode.settingsManager.terminal.setShowTerminalProgress(enabled);
      },
      onTuiModeChange: (mode) => {
        if (!this.mode.lifecycle.screen.switchTuiMode(mode)) {
          getSelector()?.getSettingsList().updateValue("tui-mode", this.mode.ui.mode);
          this.mode.display.status.showStatus("Close active overlays before changing TUI mode");
          return;
        }
        this.mode.settingsManager.terminal.setTuiMode(mode);
        if (this.mode.display.indicator.activeStatusIndicator === undefined)
          this.mode.layout.statusContainer.clear();
        this.mode.display.status.showStatus(`TUI mode: ${mode}`);
      },
    } satisfies Partial<settingsSelectorTypes.SettingsCallbacks>;
  }
}
