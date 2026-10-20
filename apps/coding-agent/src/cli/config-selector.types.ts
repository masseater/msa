import type settingsManagerTypes from "../core/settings-manager.types.ts";
import type configSelectorTypesModule from "../modes/interactive/components/config-selector.types.ts";

declare namespace configSelectorTypes {
  interface ConfigSelectorOptions {
    resolvedPaths: configSelectorTypesModule.ScopedResolvedPaths;
    settingsManager: settingsManagerTypes.SettingsManager;
    cwd: string;
    agentDir: string;
    writeScope: "global" | "project";
    projectModeAvailable: boolean;
  }
}

export type { configSelectorTypes as default };
