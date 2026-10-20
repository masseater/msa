import type settingsManagerTypes from "../src/core/settings-manager.types.ts";

declare namespace settingsManagerSupportTypes {
  interface SettingsPaths {
    readonly agentDir: string;
    readonly projectDir: string;
    readonly settingsPath: string;
    readonly projectSettingsPath: string;
    readonly openManager: (options?: {
      projectTrusted?: boolean;
    }) => settingsManagerTypes.SettingsManager;
  }
}

export type { settingsManagerSupportTypes as default };
