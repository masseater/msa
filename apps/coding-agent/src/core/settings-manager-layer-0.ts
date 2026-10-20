import settingsManagerHelpers from "./settings-manager-helpers.ts";
import type settingsManagerInternalTypes from "./settings-manager-internal.types.ts";
import type settingsManagerTypes from "./settings-manager.types.ts";
import type settingsSchemaTypes from "./settings-schema.types.ts";

const { deepMergeSettings } = settingsManagerHelpers;

export default abstract class SettingsManagerLayer0 {
  protected constructor(
    storage: settingsManagerTypes.SettingsStorage,
    initialGlobal: settingsSchemaTypes.Settings,
    initialProject: settingsSchemaTypes.Settings,
    globalLoadError: Error | null = null,
    projectLoadError: Error | null = null,
    initialErrors: settingsManagerTypes.SettingsError[] = [],
    projectTrusted = true,
    settingsPaths: settingsManagerInternalTypes.SettingsPaths = {},
  ) {
    this.storage = storage;
    this.globalSettings = initialGlobal;
    this.projectSettings = initialProject;
    this.projectTrusted = projectTrusted;
    this.globalSettingsLoadError = globalLoadError;
    this.projectSettingsLoadError = projectLoadError;
    this.errors = [...initialErrors];
    this.settingsPaths = settingsPaths;
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  protected storage!: settingsManagerTypes.SettingsStorage;
  protected globalSettings!: settingsSchemaTypes.Settings;
  protected projectSettings!: settingsSchemaTypes.Settings;
  settings!: settingsSchemaTypes.Settings;
  projectTrusted!: boolean;
  protected modifiedFields = new Set<keyof settingsSchemaTypes.Settings>();
  protected modifiedNestedFields = new Map<keyof settingsSchemaTypes.Settings, Set<string>>();
  protected modifiedProjectFields = new Set<keyof settingsSchemaTypes.Settings>();
  protected modifiedProjectNestedFields = new Map<
    keyof settingsSchemaTypes.Settings,
    Set<string>
  >();
  protected globalSettingsLoadError: Error | null = null;
  protected projectSettingsLoadError: Error | null = null;
  protected writeQueue: Promise<void> = Promise.resolve();
  protected errors!: settingsManagerTypes.SettingsError[];
  protected settingsPaths!: settingsManagerInternalTypes.SettingsPaths;
}
