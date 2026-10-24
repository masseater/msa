import type aiTypes from "@msa/ai/index.types";
import allModule from "@msa/ai/providers/all";
import localModule from "@msa/ai/providers/local";
import openrouterUserModels from "@msa/ai/providers/openrouter-user-models";

import configModule from "../../config.ts";
import platform from "../platform/index.ts";
import remoteCatalogProvider from "../remote-catalog-provider.ts";

const { withPersonalizedCatalog, withRemoteCatalog } = remoteCatalogProvider;
const { personalizeOpenRouterCatalog } = openrouterUserModels;
const { localProvider } = localModule;
const { getAgentDir } = configModule;
const { join } = platform;

const builtinCatalogProviders = (
  catalogBaseUrl: string | undefined,
  modelNetworkEnabled: boolean,
): aiTypes.Provider[] => {
  const generatedAt = allModule.getBuiltinModelDataGeneratedAt();
  const catalog = allModule
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
  return [
    ...catalog,
    localProvider({ directory: join(getAgentDir(), "models"), download: modelNetworkEnabled }),
  ];
};

const catalogProviders = { builtinCatalogProviders };

export default catalogProviders;
