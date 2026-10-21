import type aiTypes from "@msa/ai/index.types";

import type ScopedModelsSelectorComponentClass from "./scoped-models-selector.ts";

declare namespace scopedModelsSelectorTypes {
  interface ModelsConfig {
    allModels: aiTypes.Model<any>[];
    enabledModelIds: string[] | null;
    refreshStatus?: string;
  }

  interface ModelsCallbacks {
    onChange: (enabledModelIds: string[] | null) => void | Promise<void>;
    onPersist: (enabledModelIds: string[] | null) => void | Promise<void>;
    onCancel: () => void;
  }

  type ScopedModelsSelectorComponent = (typeof ScopedModelsSelectorComponentClass)["prototype"];
}

export type { scopedModelsSelectorTypes as default };
