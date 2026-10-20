import { Console, Effect } from "effect";

import type modelsDevCatalogTypes from "./models-dev-catalog.types.ts";
import directModels from "./models-dev-direct.ts";
import openCodeModels from "./models-dev-opencode.ts";
import modelsDev from "./models-dev.ts";
import remoteCatalogs from "./remote-catalogs.ts";
import upstream from "./upstream.ts";

const { createModelsDevSource } = modelsDev;
const { fetchModelsDevCatalog } = remoteCatalogs;
const { withFallback } = upstream;

const loadModelsDevModels = (strict: boolean) =>
  Effect.gen(function* () {
    const data = yield* fetchModelsDevCatalog;
    const { source, reasoning } = createModelsDevSource(data);
    const models = [...directModels(source), ...openCodeModels(source)];
    yield* Console.log(`Loaded ${models.length} tool-capable models from models.dev`);
    return { models, reasoning } satisfies modelsDevCatalogTypes.ModelsDevModels;
  }).pipe(
    withFallback({
      fallback: (): modelsDevCatalogTypes.ModelsDevModels => ({ models: [], reasoning: new Map() }),
      label: "load models.dev data",
      strict,
    }),
  );

export default loadModelsDevModels;
