import { Console, Effect } from "effect";

import buildOpenRouterCatalog from "../openrouter-catalog.ts";
import type openrouterCatalogTypes from "../openrouter-catalog.types.ts";
import type modelsDevTypes from "./models-dev.types.ts";
import upstream from "./upstream.ts";

const { UpstreamError, fetchJson, withFallback } = upstream;

const fetchModelsDevCatalog = Effect.gen(function* () {
  yield* Console.log("Fetching models from models.dev API...");
  return (yield* fetchJson({
    label: "models.dev API",
    url: "https://models.dev/api.json",
  })) as modelsDevTypes.ModelsDevCatalog;
});

const fetchOpenRouterList = (query: string) =>
  Effect.map(
    fetchJson({ label: "OpenRouter API", url: `https://openrouter.ai/api/v1/models${query}` }),
    (data) => (data as { data?: openrouterCatalogTypes.OpenRouterModelListItem[] }).data ?? [],
  );

const fetchOpenRouterModels = (strict: boolean) =>
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
      fallback: (): openrouterCatalogTypes.OpenRouterCatalog => ({
        chat: [],
        classifiers: [],
        images: [],
      }),
      label: "fetch OpenRouter models",
      strict,
    }),
  );

const remoteCatalogs = {
  fetchModelsDevCatalog,
  fetchOpenRouterModels,
};

export default remoteCatalogs;
