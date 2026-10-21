import type aiTypes from "@msa/ai/index.types";

declare namespace scopedModelsSelectorInternalTypes {
  type EnabledIds = string[] | null;

  interface ModelItem {
    fullId: string;
    model: aiTypes.Model<any> | undefined;
    enabled: boolean;
  }
}

export type { scopedModelsSelectorInternalTypes as default };
