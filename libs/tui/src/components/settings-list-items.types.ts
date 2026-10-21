import type tuiComponentTypes from "../tui-component.types.ts";

declare namespace settingsListItemsTypes {
  interface SettingItem {
    id: string;
    label: string;
    description?: string;
    currentValue: string;
    values?: string[];
    submenu?: (
      currentValue: string,
      done: (selectedValue?: string, options?: { navigateTo?: string }) => void,
    ) => tuiComponentTypes.Component;
  }

  interface SettingsListTheme {
    label: (text: string, selected: boolean) => string;
    value: (text: string, selected: boolean) => string;
    description: (text: string) => string;
    cursor: string;
    hint: (text: string) => string;
  }

  interface SettingsListOptions {
    enableSearch?: boolean;
  }
}

export type { settingsListItemsTypes as default };
