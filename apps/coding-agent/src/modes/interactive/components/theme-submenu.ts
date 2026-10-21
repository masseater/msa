import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import type themeTypes from "../theme/theme.types.ts";
import SelectSubmenu from "./select-submenu.ts";
import type settingsSelectorTypes from "./settings-selector.types.ts";
import type settingsSubmenuTypes from "./settings-submenu.types.ts";

const { SYSTEM_THEME_NAME, getSettingsListTheme, parseAutoThemeSetting, theme } = themeModule;
const { Container, SettingsList, Spacer, Text } = tui;

function themeItems(availableThemes: string[], currentTheme: string): tuiTypes.SelectItem[] {
  return availableThemes.map((name) => ({
    label: `${name === currentTheme ? "✓ " : "  "}${name}`,
    value: name,
    ...(name === SYSTEM_THEME_NAME
      ? { description: "Theme created from your terminal's colors" }
      : {}),
  }));
}

const AUTOMATIC_THEME_VALUE = "/";

function singleModeThemeItems(
  availableThemes: string[],
  currentTheme: string,
): tuiTypes.SelectItem[] {
  const items = themeItems(availableThemes, currentTheme);
  const systemIndex = items.findIndex((item) => item.value === SYSTEM_THEME_NAME);
  const system = systemIndex === -1 ? [] : items.splice(systemIndex, 1);
  return [
    ...system,
    {
      description: "Use separate themes for light and dark terminal appearance",
      label: "  automatic",
      value: AUTOMATIC_THEME_VALUE,
    },
    ...items,
  ];
}

function preferredTheme(
  availableThemes: string[],
  preferred: string | undefined,
  fallback: string,
): string {
  if (preferred !== undefined && preferred !== "" && availableThemes.includes(preferred))
    return preferred;
  if (availableThemes.includes(fallback)) return fallback;
  return availableThemes[0] ?? fallback;
}

function defaultAutomaticThemes(
  currentThemeSetting: string,
  availableThemes: string[],
): { lightTheme: string; darkTheme: string } {
  const autoTheme = parseAutoThemeSetting(currentThemeSetting);
  if (autoTheme !== undefined) return autoTheme;

  const currentFixedTheme = currentThemeSetting.includes("/") ? undefined : currentThemeSetting;
  const themeName = preferredTheme(availableThemes, currentFixedTheme, SYSTEM_THEME_NAME);
  return { darkTheme: themeName, lightTheme: themeName };
}

export default class ThemeSubmenu extends tui.Container {
  private inputComponent: tuiTypes.Component | undefined;
  private readonly callbacks: settingsSelectorTypes.SettingsCallbacks;
  private readonly availableThemes: string[];
  private readonly terminalTheme: themeTypes.TerminalTheme;
  private readonly onDone: (selectedValue?: string) => void;
  private readonly originalThemeSetting: string;
  private mode: "single" | "automatic";
  private singleTheme: string;
  private lightTheme: string;
  private darkTheme: string;

  constructor(
    currentThemeSetting: string,
    terminalTheme: themeTypes.TerminalTheme,
    availableThemes: string[],
    callbacks: settingsSelectorTypes.SettingsCallbacks,
    onDone: (selectedValue?: string) => void,
  ) {
    super();
    this.callbacks = callbacks;
    this.availableThemes = availableThemes;
    this.terminalTheme = terminalTheme;
    this.onDone = onDone;
    this.originalThemeSetting = currentThemeSetting;
    const autoTheme = parseAutoThemeSetting(currentThemeSetting);
    const automaticThemes = defaultAutomaticThemes(currentThemeSetting, availableThemes);
    const fixedTheme =
      autoTheme !== undefined || currentThemeSetting.includes("/")
        ? undefined
        : currentThemeSetting;
    this.mode = autoTheme === undefined ? "single" : "automatic";
    this.lightTheme = automaticThemes.lightTheme;
    this.darkTheme = automaticThemes.darkTheme;
    this.singleTheme = preferredTheme(
      availableThemes,
      fixedTheme ?? (autoTheme === undefined ? undefined : this.getActiveAutomaticTheme()),
      SYSTEM_THEME_NAME,
    );

    if (this.mode === "automatic") {
      this.showAutomaticMenu();
    } else {
      this.showSingleMenu();
    }
  }

  handleInput(data: string): void {
    this.inputComponent?.handleInput?.(data);
  }

  private setContent(
    renderComponent: tuiTypes.Component,
    inputComponent: tuiTypes.Component = renderComponent,
  ): void {
    this.clear();
    this.addChild(renderComponent);
    this.inputComponent = inputComponent;
  }

  private showSingleMenu(): void {
    this.mode = "single";
    const menu = new SelectSubmenu(
      "Theme",
      "Select a theme, or choose automatic to follow terminal appearance.",
      singleModeThemeItems(this.availableThemes, this.singleTheme),
      this.singleTheme,
      (value) => {
        if (value === AUTOMATIC_THEME_VALUE) {
          this.mode = "automatic";
          this.callbacks.onThemePreview?.(this.getThemeSetting());
          this.showAutomaticMenu();
          return;
        }

        this.singleTheme = value;
        this.apply(value);
      },
      () => this.cancel(),
      (value) => {
        this.callbacks.onThemePreview?.(
          value === AUTOMATIC_THEME_VALUE ? this.getAutomaticThemeSetting() : value,
        );
      },
    );
    this.setContent(menu);
  }

  private showAutomaticMenu(): void {
    const content = ThemeSubmenu.showAutomaticMenuContent(this);

    const items: tuiTypes.SettingItem[] = [
      {
        currentValue: this.lightTheme,
        description: "Theme to use in automatic mode when the terminal is light",
        id: "light-theme",
        label: "Light theme",
        submenu: (currentValue, done) =>
          this.createThemeSelect(
            "Light Theme",
            "Select the theme to use for light terminal appearance",
            currentValue,
            done,
            (value) => {
              this.lightTheme = value;
              this.callbacks.onThemePreview?.(this.getThemeSetting());
              done(value);
            },
          ),
      },
      {
        currentValue: this.darkTheme,
        description: "Theme to use in automatic mode when the terminal is dark",
        id: "dark-theme",
        label: "Dark theme",
        submenu: (currentValue, done) =>
          this.createThemeSelect(
            "Dark Theme",
            "Select the theme to use for dark terminal appearance",
            currentValue,
            done,
            (value) => {
              this.darkTheme = value;
              this.callbacks.onThemePreview?.(this.getThemeSetting());
              done(value);
            },
          ),
      },
      {
        currentValue: "save and go back",
        description: "Save and go back",
        id: "apply",
        label: "Apply",
        values: ["save and go back"],
      },
      {
        currentValue: "switch to single theme",
        description: "Switch to one theme for light and dark",
        id: "single-mode",
        label: "Change mode",
        values: ["switch to single theme"],
      },
    ];

    ThemeSubmenu.mountSettingsList(this, items, content);
  }

  private static showAutomaticMenuContent(self: ThemeSubmenu): tuiTypes.Container {
    self.mode = "automatic";
    const content = new Container();
    content.addChild(new Text(theme.bold(theme.fg("accent", "Automatic Theme")), 0, 0));
    content.addChild(new Spacer(1));
    content.addChild(
      new Text(theme.fg("muted", "Choose themes for terminal light and dark appearance."), 0, 0),
    );
    content.addChild(
      new Text(theme.fg("muted", "Light/dark detection requires terminal support."), 0, 0),
    );
    content.addChild(new Spacer(1));
    return content;
  }

  private static mountSettingsList(
    self: ThemeSubmenu,
    items: tuiTypes.SettingItem[],
    content: tuiTypes.Container,
  ): void {
    const settingsList = new SettingsList(
      items,
      Math.min(items.length, 10),
      getSettingsListTheme(),
      (id) => {
        switch (id) {
          case "single-mode":
            self.mode = "single";
            self.singleTheme = self.getActiveAutomaticTheme();
            self.callbacks.onThemePreview?.(self.singleTheme);
            self.showSingleMenu();
            break;
          case "apply":
            self.apply(self.getAutomaticThemeSetting());
            break;
        }
      },
      () => self.cancel(),
    );
    content.addChild(settingsList);
    self.setContent(content, settingsList);
  }

  private createThemeSelect(
    title: string,
    description: string,
    currentValue: string,
    done: (selectedValue?: string) => void,
    onSelect: (value: string) => void,
  ): settingsSubmenuTypes.SelectSubmenu {
    return new SelectSubmenu(
      title,
      description,
      themeItems(this.availableThemes, currentValue),
      currentValue,
      onSelect,
      () => {
        this.callbacks.onThemePreview?.(this.getThemeSetting());
        done();
      },
      (value) => this.callbacks.onThemePreview?.(value),
    );
  }

  private getThemeSetting(): string {
    return this.mode === "automatic" ? this.getAutomaticThemeSetting() : this.singleTheme;
  }

  private getActiveAutomaticTheme(): string {
    return this.terminalTheme === "light" ? this.lightTheme : this.darkTheme;
  }

  private getAutomaticThemeSetting(): string {
    return `${this.lightTheme}/${this.darkTheme}`;
  }

  private apply(themeSetting: string): void {
    this.onDone(themeSetting);
  }

  private cancel(): void {
    this.callbacks.onThemePreview?.(this.originalThemeSetting);
    this.onDone();
  }
}
