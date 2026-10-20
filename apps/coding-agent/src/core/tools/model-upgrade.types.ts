import type { Static } from "typebox";

import type modelRuntimeTypes from "../model-runtime.types.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type modelUpgrade from "./model-upgrade.ts";

declare namespace modelUpgradeTypes {
  type ModelUpgradeToolInput = Static<typeof modelUpgrade.modelUpgradeSchema>;

  interface ModelUpgradeToolTarget {
    settingsManager: settingsManagerTypes.SettingsManager;
    modelRuntime: modelRuntimeTypes.ModelRuntime;
  }
}

export type { modelUpgradeTypes as default };
