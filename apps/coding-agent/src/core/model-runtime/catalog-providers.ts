import type aiTypes from "@msa/ai/index.types";
import allModule from "@msa/ai/providers/all";
import openrouterUserModels from "@msa/ai/providers/openrouter-user-models";

import remoteCatalogProvider from "../remote-catalog-provider.ts";

const { withPersonalizedCatalog, withRemoteCatalog } = remoteCatalogProvider;
const { personalizeOpenRouterCatalog } = openrouterUserModels;

const builtinCatalogProviders = (catalogBaseUrl: string | undefined): aiTypes.Provider[] => {
  const generatedAt = allModule.getBuiltinModelDataGeneratedAt();
  return allModule
    .builtinProviders()
    .map((provider) =>
      provider.id === "openrouter"
        ? withPersonalizedCatalog(
            provider,
            personalizeOpenRouterCatalog,
            catalogBaseUrl,
            generatedAt,
          )
        : withRemoteCatalog(provider, catalogBaseUrl, generatedAt),
    );
};

const catalogProviders = { builtinCatalogProviders };

export default catalogProviders;
