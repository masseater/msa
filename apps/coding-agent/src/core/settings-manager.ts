import type settingsManagerInternalTypes from "./settings-manager-internal.types.ts";
import ContextSettings from "./settings/context-settings.ts";
import DisplaySettings from "./settings/display-settings.ts";
import ModelSettings from "./settings/model-settings.ts";
import SettingsPersistence from "./settings/persistence.ts";
import ResourceSettings from "./settings/resource-settings.ts";
import SessionSettings from "./settings/session-settings.ts";
import settingsLoading from "./settings/settings-loading.ts";
import TelemetrySettings from "./settings/telemetry-settings.ts";
import TerminalSettings from "./settings/terminal-settings.ts";

export default class SettingsManager {
  readonly persistence: SettingsPersistence;
  readonly models: ModelSettings;
  readonly display: DisplaySettings;
  readonly terminal: TerminalSettings;
  readonly resources: ResourceSettings;
  readonly session: SessionSettings;
  readonly context: ContextSettings;
  readonly telemetry: TelemetrySettings;

  storage: settingsManagerInternalTypes.Storage;
  globalSettings: settingsManagerInternalTypes.Settings;
  projectSettings: settingsManagerInternalTypes.Settings;
  settings: settingsManagerInternalTypes.Settings;
  projectTrusted: boolean;
  globalSettingsLoadError: Error | null;
  projectSettingsLoadError: Error | null;
  errors: settingsManagerInternalTypes.SettingsError[];
  settingsPaths: settingsManagerInternalTypes.SettingsPaths;

  static fromStorage(
    storage: settingsManagerInternalTypes.Storage,
    options: settingsManagerInternalTypes.CreateOptions = {},
  ): Promise<SettingsManager> {
    return settingsLoading.loadState(storage, options).then((state) => new SettingsManager(state));
  }

  static inMemory(
    settings: Partial<settingsManagerInternalTypes.Settings> = {},
    options: settingsManagerInternalTypes.CreateOptions = {},
  ): SettingsManager {
    return new SettingsManager(settingsLoading.inMemoryState(settings, options));
  }

  static create(
    cwd: string,
    agentDir?: string,
    options: settingsManagerInternalTypes.CreateOptions = {},
  ): Promise<SettingsManager> {
    const { storage, paths } = settingsLoading.fileStorage(cwd, agentDir);
    return settingsLoading
      .loadState(storage, options, paths)
      .then((state) => new SettingsManager(state));
  }

  static unloaded(
    cwd: string,
    agentDir?: string,
    options: settingsManagerInternalTypes.CreateOptions = {},
  ): SettingsManager {
    return new SettingsManager(settingsLoading.unloadedFileState(cwd, agentDir, options));
  }

  constructor(state: settingsManagerInternalTypes.SettingsState) {
    this.persistence = new SettingsPersistence(this);
    this.models = new ModelSettings(this);
    this.display = new DisplaySettings(this);
    this.terminal = new TerminalSettings(this);
    this.resources = new ResourceSettings(this);
    this.session = new SessionSettings(this);
    this.context = new ContextSettings(this);
    this.telemetry = new TelemetrySettings(this);
    this.storage = state.storage;
    this.globalSettings = state.globalSettings;
    this.projectSettings = state.projectSettings;
    this.settings = state.settings;
    this.projectTrusted = state.projectTrusted;
    this.globalSettingsLoadError = state.globalLoadError;
    this.projectSettingsLoadError = state.projectLoadError;
    this.errors = [...state.errors];
    this.settingsPaths = state.settingsPaths;
  }

  getSettings(): settingsManagerInternalTypes.Settings {
    return structuredClone(this.settings);
  }

  getGlobalSettings(): settingsManagerInternalTypes.Settings {
    return structuredClone(this.globalSettings);
  }

  getProjectSettings(): settingsManagerInternalTypes.Settings {
    return structuredClone(this.projectSettings);
  }

  isProjectTrusted(): boolean {
    return this.projectTrusted;
  }

  applyOverrides(overrides: Partial<settingsManagerInternalTypes.Settings>): void {
    this.settings = settingsLoading.mergeSettings(this.settings, overrides);
  }

  drainErrors(): settingsManagerInternalTypes.SettingsError[] {
    const drained = [...this.errors];
    this.errors = [];
    return drained;
  }
}
