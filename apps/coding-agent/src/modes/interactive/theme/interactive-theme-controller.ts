import type tuiTypes from "@msa/tui/index.types";

import type settingsManagerTypes from "../../../core/settings-manager.types.ts";
import terminalColorsModule from "./terminal-colors.ts";
import themeController from "./theme-controller.ts";
import themeModule from "./theme.ts";
import type themeTypes from "./theme.types.ts";

const {
  SYSTEM_THEME_NAME,
  initTheme,
  parseAutoThemeSetting,
  resolveThemeSetting,
  setTheme,
  setThemeInstance,
} = themeModule;
const { getTerminalTheme, markTerminalColorsPending, setTerminalColorScheme, setTerminalColors } =
  terminalColorsModule;
const { requestTerminalColors } = themeController;

type ThemeResult = { success: boolean; error?: string };
function sameRgb(a: tuiTypes.RgbColor | undefined, b: tuiTypes.RgbColor | undefined): boolean {
  return (
    a === b || (a !== undefined && b !== undefined && a.r === b.r && a.g === b.g && a.b === b.b)
  );
}
function sameTerminalColors(a: tuiTypes.TerminalColors, b: tuiTypes.TerminalColors): boolean {
  if (!sameRgb(a.foreground, b.foreground) || !sameRgb(a.background, b.background)) return false;
  if (a.palette === b.palette) return true;
  if (a.palette === undefined || b.palette === undefined || a.palette.length !== b.palette.length)
    return false;
  return a.palette.every((color, index) => sameRgb(color, b.palette?.[index]));
}
export default class InteractiveThemeController {
  private readonly ui: tuiTypes.TUI;
  private readonly getSettingsManager: () => settingsManagerTypes.SettingsManager;
  private readonly showError: (message: string) => void;
  private readonly onChanged: () => void;
  private currentThemeSetting: string | undefined;
  private terminalColors: tuiTypes.TerminalColors | undefined;
  private activeThemeName: string | undefined;
  private autoSyncEnabled = false;
  private terminalColorSchemeUnsubscribe: (() => void) | undefined;
  private terminalColorQuery: Promise<void> = Promise.resolve();

  constructor(
    ui: tuiTypes.TUI,
    options: {
      getSettingsManager: () => settingsManagerTypes.SettingsManager;
      showError: (message: string) => void;
      onChanged: () => void;
      initialThemeSetting?: string | undefined;
    },
  ) {
    this.ui = ui;
    this.getSettingsManager = options.getSettingsManager;
    this.showError = options.showError;
    this.onChanged = options.onChanged;
    this.currentThemeSetting = options.initialThemeSetting;
    this.activeThemeName = this.resolveThemeName();
    markTerminalColorsPending();
    initTheme(this.activeThemeName, true);
    this.bindTerminalColorSchemeListener();
  }

  rebindTui(): void {
    this.terminalColorSchemeUnsubscribe?.();
    this.bindTerminalColorSchemeListener();
    this.ui.setTerminalColorSchemeNotifications(this.autoSyncEnabled);
  }

  applyFromSettings(): void {
    const themeSetting = this.getThemeSetting();
    const themeName = this.resolveThemeName();
    this.setAutoSync(
      parseAutoThemeSetting(themeSetting) !== undefined || themeName === SYSTEM_THEME_NAME,
    );
    this.applyThemeName(themeName, themeSetting !== undefined);
    this.queryTerminalColors();
  }

  waitForTerminalColors(): Promise<void> {
    return this.terminalColorQuery;
  }

  getThemeSelection(): string | undefined {
    return (
      this.currentThemeSetting ??
      this.getSettingsManager().getThemeSetting() ??
      this.activeThemeName
    );
  }

  setThemeName(themeName: string, showError = false): ThemeResult {
    this.setAutoSync(themeName === SYSTEM_THEME_NAME);
    const result = this.applyThemeName(themeName, showError);
    if (result.success) {
      this.currentThemeSetting = themeName;
    }
    return result;
  }

  setThemeSetting(themeSetting: string): void {
    this.currentThemeSetting = themeSetting;
    this.applyFromSettings();
  }

  setThemeInstance(themeInstance: themeTypes.Theme): ThemeResult {
    this.setAutoSync(false);
    setThemeInstance(themeInstance);
    this.activeThemeName = "<in-memory>";
    this.notifyChanged();
    return { success: true };
  }

  preview(themeSettingOrName: string): void {
    const themeName =
      resolveThemeSetting(themeSettingOrName, getTerminalTheme()) ?? this.activeThemeName;
    if (themeName === undefined || themeName === "") return;
    if (setTheme(themeName, true).success) {
      this.ui.invalidate();
      this.ui.requestRender();
    }
  }

  disableAutoSync(): void {
    this.setAutoSync(false);
  }

  dispose(): void {
    this.setAutoSync(false);
    this.terminalColorSchemeUnsubscribe?.();
    this.terminalColorSchemeUnsubscribe = undefined;
  }

  getTerminalTheme(): themeTypes.TerminalTheme {
    return getTerminalTheme();
  }

  private getThemeSetting(): string | undefined {
    return this.currentThemeSetting ?? this.getSettingsManager().getThemeSetting();
  }

  private resolveThemeName(): string {
    return resolveThemeSetting(this.getThemeSetting(), getTerminalTheme()) ?? SYSTEM_THEME_NAME;
  }

  private applyThemeName(themeName: string, showError = false): ThemeResult {
    const result = setTheme(themeName, true);
    this.activeThemeName = result.success ? themeName : SYSTEM_THEME_NAME;
    this.notifyChanged();
    if (!result.success && showError) {
      this.showError(
        `Failed to load theme "${themeName}": ${result.error}\nFell back to the system theme.`,
      );
    }
    return result;
  }

  private queryTerminalColors(): void {
    this.terminalColorQuery = requestTerminalColors(this.ui, (colors) =>
      this.applyTerminalColors(colors),
    );
  }

  private applyTerminalColors(reported: tuiTypes.TerminalColors): void {
    const previous = this.terminalColors;
    const foreground = reported.foreground ?? previous?.foreground;
    const background = reported.background ?? previous?.background;
    const palette = reported.palette ?? previous?.palette;
    const next: tuiTypes.TerminalColors = {
      ...(foreground === undefined ? {} : { foreground }),
      ...(background === undefined ? {} : { background }),
      ...(palette === undefined ? {} : { palette }),
    };
    if (previous !== undefined && sameTerminalColors(previous, next)) return;
    this.terminalColors = next;
    setTerminalColors(next);
    this.reapplyForTerminal();
    this.ui.invalidate();
    this.ui.requestRender();
  }

  private reapplyForTerminal(): void {
    if (this.activeThemeName === "<in-memory>") return;
    const themeName = this.resolveThemeName();
    if (themeName === SYSTEM_THEME_NAME || themeName !== this.activeThemeName) {
      this.applyThemeName(themeName);
    }
  }

  private setAutoSync(enabled: boolean): void {
    if (this.autoSyncEnabled === enabled) return;
    this.autoSyncEnabled = enabled;
    this.ui.setTerminalColorSchemeNotifications(enabled);
  }

  private bindTerminalColorSchemeListener(): void {
    this.terminalColorSchemeUnsubscribe = this.ui.onTerminalColorSchemeChange((terminalTheme) =>
      this.applyTerminalColorSchemeChange(terminalTheme),
    );
  }

  private applyTerminalColorSchemeChange(terminalTheme: themeTypes.TerminalTheme): void {
    if (!this.autoSyncEnabled) return;
    const previous = getTerminalTheme();
    setTerminalColorScheme(terminalTheme);
    if (getTerminalTheme() !== previous) this.reapplyForTerminal();
    this.queryTerminalColors();
  }

  private notifyChanged(): void {
    this.ui.invalidate();
    this.onChanged();
  }
}
