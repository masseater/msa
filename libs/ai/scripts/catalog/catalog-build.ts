import type typesModule from "../../src/types.types.ts";
import type catalogBuildTypes from "./catalog-build.types.ts";
import modelMetadata from "./model-metadata.ts";

const { applyImageInputMetadata } = modelMetadata;

interface ProviderCatalog {
  chat: Record<string, typesModule.Model<typesModule.Api>>;
  image: Record<string, typesModule.ImageModel<typesModule.ImageApi>>;
  classifier: Record<string, typesModule.ClassifierModel<typesModule.ClassifierApi>>;
}

function collectProviders({ chat, images, classifiers }: catalogBuildTypes.CatalogSources) {
  const providers: Record<string, ProviderCatalog> = {};
  const providerCatalog = (provider: string): ProviderCatalog =>
    (providers[provider] ??= { chat: {}, classifier: {}, image: {} });
  for (const model of chat) {
    providerCatalog(model.provider).chat[model.id] ??= { ...model, type: "chat" };
  }
  for (const model of images) {
    applyImageInputMetadata(model);
    providerCatalog(model.provider).image[model.id] ??= model;
  }
  for (const model of classifiers) {
    providerCatalog(model.provider).classifier[model.id] ??= model;
  }
  return providers;
}

function sortedById<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildCatalog(sources: catalogBuildTypes.CatalogSources): catalogBuildTypes.BuiltCatalog {
  const providers = collectProviders(sources);
  const sortedProviders = Object.entries(providers).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const chatProviders: Record<string, Record<string, typesModule.Model<typesModule.Api>>> = {};
  const allProviders: Record<string, catalogBuildTypes.CatalogEntry[]> = {};
  for (const [providerId, catalog] of sortedProviders) {
    const chat = sortedById(catalog.chat);
    chatProviders[providerId] = chat;
    allProviders[providerId] = [
      ...Object.values(chat),
      ...Object.values(sortedById(catalog.image)),
      ...Object.values(sortedById(catalog.classifier)),
    ] as catalogBuildTypes.CatalogEntry[];
  }
  return {
    allProviders,
    chatProviders,
    counts: Object.entries(providers).map(([provider, models]) => ({
      chat: Object.keys(models.chat).length,
      classifier: Object.keys(models.classifier).length,
      image: Object.keys(models.image).length,
      provider,
    })),
    providerIds: sortedProviders.map(([providerId]) => providerId),
  };
}

export default buildCatalog;
