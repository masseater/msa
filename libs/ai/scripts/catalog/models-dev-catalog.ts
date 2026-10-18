import { Console, Effect } from "effect";

import type { Model } from "../../src/types.ts";
import { directModels } from "./models-dev-direct.ts";
import { openCodeModels } from "./models-dev-opencode.ts";
import { createModelsDevSource, type ReasoningOptionsRegistry } from "./models-dev.ts";
import { fetchModelsDevCatalog } from "./remote-catalogs.ts";
import { withFallback } from "./upstream.ts";

export interface ModelsDevModels {
  readonly models: Model<any>[];
  readonly reasoning: ReasoningOptionsRegistry;
}

export const loadModelsDevModels = (strict: boolean) =>
  Effect.gen(function* () {
    const data = yield* fetchModelsDevCatalog;
    const { source, reasoning } = createModelsDevSource(data);
    const models = [...directModels(source), ...openCodeModels(source)];
    yield* Console.log(`Loaded ${models.length} tool-capable models from models.dev`);
    return { models, reasoning } satisfies ModelsDevModels;
  }).pipe(
    withFallback({
      label: "load models.dev data",
      strict,
      fallback: (): ModelsDevModels => ({ models: [], reasoning: new Map() }),
    }),
  );
