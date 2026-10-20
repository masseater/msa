import type settingsManagerTypes from "./settings-manager.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

declare namespace settingsManagerInternalTypes {
  type SettingsPaths = Partial<Record<settingsManagerTypes.SettingsScope, string>>;

  type ObjectSettingKey = {
    [K in keyof settingsSchemaTypes.Settings]-?: NonNullable<
      settingsSchemaTypes.Settings[K]
    > extends readonly unknown[]
      ? never
      : NonNullable<settingsSchemaTypes.Settings[K]> extends Record<string, unknown>
        ? K
        : never;
  }[keyof settingsSchemaTypes.Settings];
}

export type { settingsManagerInternalTypes as default };
