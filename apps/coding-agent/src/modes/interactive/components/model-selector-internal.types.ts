import type aiTypes from "@msa/ai/index.types";

declare namespace modelSelectorInternalTypes {
  interface ModelItem {
    provider: string;
    id: string;
    model: aiTypes.Model<any>;

    deniedBy?: string | undefined;
  }

  interface ScopedModelItem {
    model: aiTypes.Model<any>;
    thinkingLevel?: string | undefined;
  }

  interface DefaultModelReference {
    provider: string;
    id: string;
  }

  type ModelScope = "all" | "scoped" | "hidden";
}

export type { modelSelectorInternalTypes as default };
