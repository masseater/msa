import type { SettingsManager } from "../src/core/settings-manager.ts";

declare namespace settingsManagerSupportTypes {
  interface SettingsPaths {
    readonly agentDir: string;
    readonly projectDir: string;
    readonly settingsPath: string;
    readonly projectSettingsPath: string;
    readonly openManager: (options?: { projectTrusted?: boolean }) => SettingsManager;
  }
}

export type { settingsManagerSupportTypes as default };
