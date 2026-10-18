import type {
  AnyModel,
  Api,
  ClassifierApi,
  ClassifierModel,
  ImageApi,
  ImageModel,
  Model,
} from "../../src/types.ts";
import type { ModelCatalogEntry } from "../model-data.ts";
import { applyImageInputMetadata } from "./model-metadata.ts";

interface ProviderCatalog {
  chat: Record<string, Model<Api>>;
  image: Record<string, ImageModel<ImageApi>>;
  classifier: Record<string, ClassifierModel<ClassifierApi>>;
}

export type CatalogEntry = AnyModel & ModelCatalogEntry;

export interface CatalogSources {
  readonly chat: readonly Model<any>[];
  readonly images: readonly ImageModel<ImageApi>[];
  readonly classifiers: readonly ClassifierModel<ClassifierApi>[];
}

export interface ProviderCounts {
  readonly provider: string;
  readonly chat: number;
  readonly image: number;
  readonly classifier: number;
}

export interface BuiltCatalog {
  readonly providerIds: readonly string[];
  readonly chatProviders: Readonly<Record<string, Record<string, Model<Api>>>>;
  readonly allProviders: Readonly<Record<string, CatalogEntry[]>>;
  readonly counts: readonly ProviderCounts[];
}

function collectProviders({ chat, images, classifiers }: CatalogSources) {
  const providers: Record<string, ProviderCatalog> = {};
  const providerCatalog = (provider: string): ProviderCatalog =>
    (providers[provider] ??= { chat: {}, image: {}, classifier: {} });
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

export function buildCatalog(sources: CatalogSources): BuiltCatalog {
  const providers = collectProviders(sources);
  const sortedProviders = Object.entries(providers).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const chatProviders: Record<string, Record<string, Model<Api>>> = {};
  const allProviders: Record<string, CatalogEntry[]> = {};
  for (const [providerId, catalog] of sortedProviders) {
    const chat = sortedById(catalog.chat);
    chatProviders[providerId] = chat;
    allProviders[providerId] = [
      ...Object.values(chat),
      ...Object.values(sortedById(catalog.image)),
      ...Object.values(sortedById(catalog.classifier)),
    ] as CatalogEntry[];
  }
  return {
    providerIds: sortedProviders.map(([providerId]) => providerId),
    chatProviders,
    allProviders,
    counts: Object.entries(providers).map(([provider, models]) => ({
      provider,
      chat: Object.keys(models.chat).length,
      image: Object.keys(models.image).length,
      classifier: Object.keys(models.classifier).length,
    })),
  };
}
