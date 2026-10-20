import type extensionsTypesTypes from "../../core/extensions/types.types.ts";

declare namespace toolInternalTypes {
  interface CatalogEntry {
    name: string;
    section: string;
    cost: number;
  }

  interface CatalogGroup {
    namespace: extensionsTypesTypes.ToolNamespace | undefined;
    entries: CatalogEntry[];
  }
}

export type { toolInternalTypes as default };
