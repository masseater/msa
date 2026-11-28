import type { Effect } from "effect";

import type settingsManagerTypes from "../src/core/settings-manager.types.ts";

declare namespace settingsManagerSupportTypes {
  interface SettingsFiles {
    readonly global?: Readonly<Record<string, unknown>>;
    readonly project?: Readonly<Record<string, unknown>>;
  }

  interface SettingsPaths {
    readonly agentDir: string;
    readonly projectDir: string;
    readonly settingsPath: string;
    readonly projectSettingsPath: string;
    readonly openManager: (options?: {
      projectTrusted?: boolean;
    }) => Effect.Effect<settingsManagerTypes.SettingsManager>;
  }
}

export type { settingsManagerSupportTypes as default };
