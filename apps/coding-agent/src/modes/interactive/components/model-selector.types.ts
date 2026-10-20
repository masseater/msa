import type aiTypes from "@msa/ai/index.types";

import type modelPolicyTypes from "../../../core/model-policy.types.ts";
import type ModelSelectorComponentClass from "./model-selector.ts";

declare namespace modelSelectorTypes {
  interface ModelSelectorPolicyOptions {
    getPolicy(): modelPolicyTypes.ModelPolicy;

    getCatalogModels(): readonly aiTypes.Model<any>[];

    savePolicy(policy: modelPolicyTypes.ModelPolicy): modelPolicyTypes.ModelPolicy;
  }

  type ModelSelectorComponent = (typeof ModelSelectorComponentClass)["prototype"];
}

export type { modelSelectorTypes as default };
