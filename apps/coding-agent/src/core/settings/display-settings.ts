import settingsDefaults from "../settings-defaults.ts";
import type SettingsManager from "../settings-manager.ts";
import type settingsSchemaTypes from "../settings-schema.types.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;

export default class DisplaySettings {
  private readonly manager: SettingsManager;

  constructor(manager: SettingsManager) {
    this.manager = manager;
  }

  getLastChangelogVersion(): string | undefined {
    return this.manager.settings.lastChangelogVersion;
  }

  getThemeSetting(): string | undefined {
    const value = this.manager.settings.theme;
    if (typeof value === "string") return value;
    return undefined;
  }

  getTheme(): string | undefined {
    const theme = this.getThemeSetting();
    return theme?.includes("/") === true ? undefined : theme;
  }

  getHideThinkingBlock(): boolean {
    return this.manager.settings.hideThinkingBlock ?? SETTINGS_DEFAULTS.hideThinkingBlock;
  }

  getShowCacheMissNotices(): boolean {
    return this.manager.settings.showCacheMissNotices ?? SETTINGS_DEFAULTS.showCacheMissNotices;
  }

  getQuietStartup(): settingsSchemaTypes.QuietStartup {
    const value = this.manager.settings.quietStartup;
    return value === true || value === "header" ? value : SETTINGS_DEFAULTS.quietStartup;
  }

  getCollapseChangelog(): boolean {
    return this.manager.settings.collapseChangelog ?? SETTINGS_DEFAULTS.collapseChangelog;
  }

  getShowImages(): boolean {
    return this.manager.settings.terminal?.showImages ?? SETTINGS_DEFAULTS.terminal.showImages;
  }

  getImageWidthCells(): number {
    const width = this.manager.settings.terminal?.imageWidthCells;
    if (typeof width !== "number" || !Number.isFinite(width)) {
      return SETTINGS_DEFAULTS.terminal.imageWidthCells;
    }
    return Math.max(1, Math.floor(width));
  }

  getImageAutoResize(): boolean {
    return this.manager.settings.images?.autoResize ?? SETTINGS_DEFAULTS.images.autoResize;
  }

  getBlockImages(): boolean {
    return this.manager.settings.images?.blockImages ?? SETTINGS_DEFAULTS.images.blockImages;
  }

  getCodeBlockIndent(): string {
    return (
      this.manager.settings.markdown?.codeBlockIndent ?? SETTINGS_DEFAULTS.markdown.codeBlockIndent
    );
  }

  getMermaidRenderingMode(): settingsSchemaTypes.MermaidRenderingMode {
    const mode = this.manager.settings.markdown?.mermaid;
    return mode === "off" || mode === "final" ? mode : SETTINGS_DEFAULTS.markdown.mermaid;
  }

  setLastChangelogVersion(version: string): void {
    this.manager.persistence.setGlobalSetting("lastChangelogVersion", version);
  }

  setTheme(theme: string): void {
    this.manager.persistence.setGlobalSetting("theme", theme);
  }

  setHideThinkingBlock(hide: boolean): void {
    this.manager.persistence.setGlobalSetting("hideThinkingBlock", hide);
  }

  setShowCacheMissNotices(show: boolean): void {
    this.manager.persistence.setGlobalSetting("showCacheMissNotices", show);
  }

  setQuietStartup(quiet: settingsSchemaTypes.QuietStartup): void {
    this.manager.persistence.setGlobalSetting("quietStartup", quiet);
  }

  setCollapseChangelog(collapse: boolean): void {
    this.manager.persistence.setGlobalSetting("collapseChangelog", collapse);
  }

  setShowImages(show: boolean): void {
    this.manager.persistence.setNestedGlobalSetting("terminal", "showImages", show);
  }

  setImageWidthCells(width: number): void {
    this.manager.persistence.setNestedGlobalSetting(
      "terminal",
      "imageWidthCells",
      Math.max(1, Math.floor(width)),
    );
  }

  setImageAutoResize(enabled: boolean): void {
    this.manager.persistence.setNestedGlobalSetting("images", "autoResize", enabled);
  }

  setBlockImages(blocked: boolean): void {
    this.manager.persistence.setNestedGlobalSetting("images", "blockImages", blocked);
  }

  setMermaidRenderingMode(mode: settingsSchemaTypes.MermaidRenderingMode): void {
    this.manager.persistence.setNestedGlobalSetting("markdown", "mermaid", mode);
  }
}
