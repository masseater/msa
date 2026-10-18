import { Console, Effect } from "effect";

import {
  buildOpenRouterCatalog,
  type OpenRouterCatalog,
  type OpenRouterModelListItem,
} from "../openrouter-catalog.ts";
import type { ModelsDevCatalog } from "./models-dev.ts";
import { fetchJson, UpstreamError, withFallback } from "./upstream.ts";

export const fetchModelsDevCatalog = Effect.gen(function* () {
  yield* Console.log("Fetching models from models.dev API...");
  return (yield* fetchJson({
    url: "https://models.dev/api.json",
    label: "models.dev API",
  })) as ModelsDevCatalog;
});

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
