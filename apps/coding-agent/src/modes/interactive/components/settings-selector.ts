import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import keybindingHints from "./keybinding-hints.ts";
import ModelThinkingSubmenu from "./model-thinking-submenu.ts";
import settingsBehaviorEntries from "./settings-behavior-entries.ts";
import settingsDisplayEntries from "./settings-display-entries.ts";
import type settingsSelectorTypes from "./settings-selector.types.ts";
import ThemeSubmenu from "./theme-submenu.ts";

const { keyDisplayText } = keybindingHints;
const { SettingsList, getCapabilities } = tui;

type Config = settingsSelectorTypes.SettingsConfig;
type Callbacks = settingsSelectorTypes.SettingsCallbacks;
type SettingEntry = settingsSelectorTypes.SettingEntry;

function modelThinkingEntry(config: Config, callbacks: Callbacks): SettingEntry {
  const submenu = new ModelThinkingSubmenu(config);
  const cycleThinkingKey = keyDisplayText("app.thinking.cycle");
  return {
    item: {
      currentValue: submenu.summary(),
      description: `Override the default thinking level for specific models. ${cycleThinkingKey} cycles in-session.`,
      id: "model-thinking",
      label: "Default thinking level per model",
      submenu: (_currentValue, done) => submenu.open(callbacks, done),
    },
  };
}

function themeEntry(config: Config, callbacks: Callbacks): SettingEntry {
  return {
    apply: (value, settingsCallbacks) => settingsCallbacks.onThemeChange(value),
    item: {
      currentValue: config.currentTheme,
      description: "Color theme for the interface",
      id: "theme",
      label: "Theme",
      submenu: (currentValue, done) =>
        new ThemeSubmenu(
          currentValue,
          config.terminalTheme,
          config.availableThemes,
          callbacks,
          done,
        ),
    },
  };
}

function settingEntries(config: Config, callbacks: Callbacks): SettingEntry[] {
  const supportsImages = getCapabilities().images !== null;
  const followUpKey = keyDisplayText("app.message.followUp");
  return [
    settingsBehaviorEntries.autoCompactEntry(config),
    ...settingsDisplayEntries.inputDisplayEntries(config, supportsImages),
    ...settingsBehaviorEntries.sessionEntries(config, followUpKey),
    modelThinkingEntry(config, callbacks),
    ...settingsDisplayEntries.fullscreenEntries(config),
    themeEntry(config, callbacks),
  ];
}

export default class SettingsSelectorComponent extends tui.Container {
  private settingsList: tuiTypes.SettingsList;

  constructor(config: Config, callbacks: Callbacks) {
    super();
    const entries = settingEntries(config, callbacks);
    const entriesById = new Map(entries.map((entry) => [entry.item.id, entry]));
    this.addChild(new DynamicBorder());
    this.settingsList = new SettingsList(
      entries.map((entry) => entry.item),
      10,
      themeModule.getSettingsListTheme(),
      (id, newValue) => entriesById.get(id)?.apply?.(newValue, callbacks),
      callbacks.onCancel,
      { enableSearch: true },
    );
    this.addChild(this.settingsList);
    this.addChild(new DynamicBorder());
  }

  getSettingsList(): tuiTypes.SettingsList {
    return this.settingsList;
  }
}
