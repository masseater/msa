import type aiTypes from "@msa/ai/index.types";
import type { Static } from "typebox";

import type modelRuntimeTypes from "../model-runtime.types.ts";
import type settingsManagerTypes from "../settings-manager.types.ts";
import type modelPolicy from "./model-policy.ts";

declare namespace modelPolicyTypes {
  type ModelPolicyToolInput = Static<typeof modelPolicy.modelPolicySchema>;

  interface ModelPolicyToolTarget {
    settingsManager: settingsManagerTypes.SettingsManager;
    modelRuntime: modelRuntimeTypes.ModelRuntime;

    currentModel(): aiTypes.Model<aiTypes.Api> | undefined;
  }
}

export type { modelPolicyTypes as default };
