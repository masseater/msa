import { Console, Effect } from "effect";

import {
  DEFAULT_RADIUS_GATEWAY,
  getRadiusModelsFromConfig,
  loadRadiusGatewayConfig,
} from "../../src/providers/radius-config.ts";
import type { ClassifierModel, Model } from "../../src/types.ts";
import {
  buildOpenRouterCatalog,
  type OpenRouterCatalog,
  type OpenRouterModelListItem,
} from "../openrouter-catalog.ts";
import type { ModelsDevCatalog, ModelsDevMetadata } from "./models-dev.ts";
import { fetchJson, UpstreamError, withFallback } from "./upstream.ts";

export const fetchModelsDevCatalog = Effect.gen(function* () {
  yield* Console.log("Fetching models from models.dev API...");
  return (yield* fetchJson({
    url: "https://models.dev/api.json",
    label: "models.dev API",
  })) as ModelsDevCatalog;
});

const classifierFromMetadata = (
  metadata: ModelsDevMetadata,
): ClassifierModel<"typesafe-system-one"> => ({
  type: "classifier",
  id: "jev-latest",
  name: metadata.name,
  api: "typesafe-system-one",
  provider: "typesafe",
  baseUrl: "https://api.typesafe.ai/v1/",
  input: metadata.modalities?.input?.includes("image") === true ? ["text", "image"] : ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: metadata.limit?.context || 64000,
});

export const fetchModelsDevClassifierModels = (strict: boolean) =>
  Effect.gen(function* () {
    yield* Console.log("Fetching classifier models from models.dev API...");
    const data = (yield* fetchJson({
      url: "https://models.dev/models.json?type=decision",
      label: "models.dev classifier API",
    })) as Record<string, ModelsDevMetadata>;
    const metadata = data["typesafe/jev-latest"];
    if (metadata === undefined || metadata.type !== "decision") {
      return yield* new UpstreamError({
        message: "models.dev did not return decision model typesafe/jev-latest",
      });
    }
    return [classifierFromMetadata(metadata)];
  }).pipe(
    withFallback({
      label: "load models.dev classifier data",
      strict,
      fallback: (): ClassifierModel<"typesafe-system-one">[] => [],
    }),
  );

const fetchOpenRouterList = (query: string) =>
  Effect.map(
    fetchJson({ url: `https://openrouter.ai/api/v1/models${query}`, label: "OpenRouter API" }),
    (data) => (data as { data?: OpenRouterModelListItem[] }).data ?? [],
  );

export const fetchOpenRouterModels = (strict: boolean) =>
  Effect.gen(function* () {
    yield* Console.log("Fetching models from OpenRouter API...");
    const [listed, imageListed, decisionListed] = yield* Effect.all(
      [
        fetchOpenRouterList(""),
        fetchOpenRouterList("?output_modalities=image"),
        fetchOpenRouterList("?output_modalities=decisions"),
      ],
      { concurrency: "unbounded" },
    );
    const catalog = buildOpenRouterCatalog(listed, imageListed, decisionListed);
    yield* Console.log(
      `Fetched ${catalog.chat.length} tool-capable, ${catalog.images.length} image, and ${catalog.classifiers.length} classifier models from OpenRouter`,
    );
    if (strict && catalog.images.length === 0) {
      return yield* new UpstreamError({
        message: "OpenRouter API returned no usable image models",
      });
    }
    return catalog;
  }).pipe(
    withFallback({
      label: "fetch OpenRouter models",
      strict,
      fallback: (): OpenRouterCatalog => ({ chat: [], images: [], classifiers: [] }),
    }),
  );

export const fetchRadiusModels = (strict: boolean) =>
  Effect.gen(function* () {
    yield* Console.log("Fetching models from Radius API...");
    const config = yield* loadRadiusGatewayConfig({ gateway: DEFAULT_RADIUS_GATEWAY });
    const models = getRadiusModelsFromConfig("radius", config);
    if (models.length === 0)
      return yield* new UpstreamError({ message: "Radius API returned no models" });
    yield* Console.log(`Fetched ${models.length} models from Radius`);
    return models;
  }).pipe(
    withFallback({
      label: "fetch Radius models",
      strict,
      fallback: (): Model<"msa-messages">[] => [],
    }),
  );
