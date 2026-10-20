import type aiTypes from "@msa/ai/index.types";

declare namespace remoteCatalogProviderTypes {
  type PersonalizeCatalog = (
    catalog: readonly aiTypes.AnyModel[],
    context: aiTypes.RefreshModelsContext,
  ) => Promise<readonly aiTypes.AnyModel[]>;
}

export type { remoteCatalogProviderTypes as default };
