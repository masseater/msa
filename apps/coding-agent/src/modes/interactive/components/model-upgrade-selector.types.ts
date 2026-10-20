import type modelUpgradeTypes from "../../../core/model-upgrade.types.ts";
import type ModelUpgradeSelectorComponentClass from "./model-upgrade-selector.ts";

declare namespace modelUpgradeSelectorTypes {
  interface ModelUpgradeCallbacks {
    onApply(candidate: modelUpgradeTypes.ModelUpgradeCandidate): Promise<string>;
    onCancel: () => void;
    requestRender: () => void;
  }

  type ModelUpgradeSelectorComponent = (typeof ModelUpgradeSelectorComponentClass)["prototype"];
}

export type { modelUpgradeSelectorTypes as default };
