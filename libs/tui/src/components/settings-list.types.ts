import type settingsListItemsTypes from "./settings-list-items.types.ts";
import type SettingsListClass from "./settings-list.ts";

declare namespace settingsListTypes {
  type SettingItem = settingsListItemsTypes.SettingItem;

  type SettingsListOptions = settingsListItemsTypes.SettingsListOptions;

  type SettingsListTheme = settingsListItemsTypes.SettingsListTheme;

  type SettingsList = SettingsListClass;
}

export type { settingsListTypes as default };
