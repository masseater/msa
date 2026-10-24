import type tuiTypes from "@msa/tui/index.types";

import platform from "../platform/index.ts";
import settingsDefaults from "../settings-defaults.ts";
import type SettingsManager from "../settings-manager.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { readEnv } = platform;

export default class TerminalSettings {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
  }

  getClipboardImageCommand(): string | undefined {
    const command = this.manager.globalSettings.clipboardImageCommand;
    return typeof command === "string" && command.trim() !== "" ? command : undefined;
  }

  getNotifyCommand(): string | undefined {
    const command = this.manager.globalSettings.notifyCommand;
    return typeof command === "string" && command.trim() !== "" ? command : undefined;
  }

  getExternalEditorCommand(): string {
    const configuredEditor = this.manager.settings.externalEditor;
    if (typeof configuredEditor === "string" && configuredEditor.trim() !== "") {
      return configuredEditor;
    }
    const environmentEditor = readEnv("VISUAL") || readEnv("EDITOR");
    if (environmentEditor !== undefined && environmentEditor !== "") {
      return environmentEditor;
    }
    return process.platform === "win32" ? "notepad" : "nano";
  }

  getClearOnShrink(): boolean {
    if (this.manager.settings.terminal?.clearOnShrink !== undefined) {
      return this.manager.settings.terminal.clearOnShrink;
    }
    if (readEnv("MSA_CLEAR_ON_SHRINK") === "1") return true;
    return SETTINGS_DEFAULTS.terminal.clearOnShrink;
  }

  getShowTerminalProgress(): boolean {
    return (
      this.manager.settings.terminal?.showTerminalProgress ??
      SETTINGS_DEFAULTS.terminal.showTerminalProgress
    );
  }

  getTuiMode(): settingsSchemaTypes.TuiMode {
    return this.manager.settings.tuiMode === "regular" ? "regular" : SETTINGS_DEFAULTS.tuiMode;
  }

  getFullscreenExitOutput(): settingsSchemaTypes.FullscreenExitOutput {
    return this.manager.settings.fullscreenExitOutput === "resume-hint"
      ? "resume-hint"
      : SETTINGS_DEFAULTS.fullscreenExitOutput;
  }

  getFullscreenScrollbar(): tuiTypes.ScrollViewScrollbar {
    const mode = this.manager.settings.fullscreenScrollbar;
    return mode === "always" || mode === "hidden" ? mode : SETTINGS_DEFAULTS.fullscreenScrollbar;
  }

  getFullscreenCopyOnSelect(): boolean {
    return this.manager.settings.fullscreenCopyOnSelect ?? SETTINGS_DEFAULTS.fullscreenCopyOnSelect;
  }

  getFullscreenWheelScrollLines(): tuiTypes.WheelScrollLines {
    const lines = this.manager.settings.fullscreenWheelScrollLines;
    return typeof lines === "number" && Number.isFinite(lines)
      ? Math.max(1, Math.min(100, Math.floor(lines)))
      : SETTINGS_DEFAULTS.fullscreenWheelScrollLines;
  }

  getDoubleEscapeAction(): "fork" | "tree" | "none" {
    return this.manager.settings.doubleEscapeAction ?? SETTINGS_DEFAULTS.doubleEscapeAction;
  }

  getTreeFilterMode(): "default" | "no-tools" | "user-only" | "labeled-only" | "all" {
    const mode = this.manager.settings.treeFilterMode;
    const valid = ["default", "no-tools", "user-only", "labeled-only", "all"];
    return mode !== undefined && valid.includes(mode) ? mode : SETTINGS_DEFAULTS.treeFilterMode;
  }

  getShowHardwareCursor(): boolean {
    return this.manager.settings.showHardwareCursor ?? readEnv("MSA_HARDWARE_CURSOR") === "1";
  }

  getEditorPaddingX(): number {
    return this.manager.settings.editorPaddingX ?? SETTINGS_DEFAULTS.editorPaddingX;
  }

  getOutputPad(): 0 | 1 {
    return this.manager.settings.outputPad === 0 ? 0 : SETTINGS_DEFAULTS.outputPad;
  }

  getAutocompleteMaxVisible(): number {
    return this.manager.settings.autocompleteMaxVisible ?? SETTINGS_DEFAULTS.autocompleteMaxVisible;
  }

  getTerminalCapabilityOverrides(): Partial<tuiTypes.TerminalCapabilities> {
    const terminal = this.manager.settings.terminal;
    const images = terminal?.images;
    return {
      ...(images === "kitty" || images === "iterm2"
        ? { images }
        : images === false
          ? { images: null }
          : {}),
      ...(typeof terminal?.trueColor === "boolean" ? { trueColor: terminal.trueColor } : {}),
      ...(typeof terminal?.hyperlinks === "boolean" ? { hyperlinks: terminal.hyperlinks } : {}),
    };
  }

  setTuiMode(mode: settingsSchemaTypes.TuiMode): void {
    this.manager.persistence.setGlobalSetting("tuiMode", mode);
  }

  setFullscreenExitOutput(output: settingsSchemaTypes.FullscreenExitOutput): void {
    this.manager.persistence.setGlobalSetting("fullscreenExitOutput", output);
  }

  setFullscreenWheelScrollLines(lines: tuiTypes.WheelScrollLines): void {
    this.manager.globalSettings.fullscreenWheelScrollLines =
      lines === "auto" ? lines : Math.max(1, Math.min(100, Math.floor(lines)));
    this.manager.persistence.markModified("fullscreenWheelScrollLines");
    this.manager.persistence.save();
  }

  setFullscreenScrollbar(mode: tuiTypes.ScrollViewScrollbar): void {
    this.manager.persistence.setGlobalSetting("fullscreenScrollbar", mode);
  }

  setFullscreenCopyOnSelect(enabled: boolean): void {
    this.manager.persistence.setGlobalSetting("fullscreenCopyOnSelect", enabled);
  }

  setDoubleEscapeAction(action: "fork" | "tree" | "none"): void {
    this.manager.persistence.setGlobalSetting("doubleEscapeAction", action);
  }

  setTreeFilterMode(mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all"): void {
    this.manager.persistence.setGlobalSetting("treeFilterMode", mode);
  }

  setShowHardwareCursor(enabled: boolean): void {
    this.manager.persistence.setGlobalSetting("showHardwareCursor", enabled);
  }

  setEditorPaddingX(padding: number): void {
    this.manager.persistence.setGlobalSetting(
      "editorPaddingX",
      Math.max(0, Math.min(3, Math.floor(padding))),
    );
  }

  setOutputPad(padding: 0 | 1): void {
    this.manager.persistence.setGlobalSetting("outputPad", padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.manager.persistence.setGlobalSetting(
      "autocompleteMaxVisible",
      Math.max(3, Math.min(20, Math.floor(maxVisible))),
    );
  }

  setClearOnShrink(enabled: boolean): void {
    this.manager.persistence.setNestedGlobalSetting("terminal", "clearOnShrink", enabled);
  }

  setShowTerminalProgress(enabled: boolean): void {
    this.manager.persistence.setNestedGlobalSetting("terminal", "showTerminalProgress", enabled);
  }
}
