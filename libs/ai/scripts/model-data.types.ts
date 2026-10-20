import type modelData from "./model-data.ts";

declare namespace modelDataTypes {
  type ModelDataStructure = Record<string, Record<string, string>>;

  interface ModelDataManifest {
    schemaVersion: number;
    generatedAt: string;
    structureHash: string;
    files: Record<string, string>;
  }

  interface ModelCatalogEntry {
    type: string;
    id: string;
    api: string;
  }

  interface ProviderModelData<T extends ModelCatalogEntry> {
    readonly groups: Record<string, Record<string, T>>;
    readonly structure: Record<string, string>;
  }

  type ModelDataError = (typeof modelData.ModelDataError)["prototype"];
}

export type { modelDataTypes as default };
