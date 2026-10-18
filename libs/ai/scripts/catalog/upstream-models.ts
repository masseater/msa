import { Effect } from "effect";

import type {
  ClassifierApi,
  ClassifierModel,
  ImageApi,
  ImageModel,
  Model,
} from "../../src/types.ts";
import { loadModelsDevModels } from "./models-dev-catalog.ts";
import type { ReasoningOptionsRegistry } from "./models-dev.ts";
import { fetchOpenRouterModels } from "./remote-catalogs.ts";
import { OPENCODE_CLASSIFIER_MODELS } from "./static-models.ts";
import { OPENAI_CLASSIFIER_MODELS } from "./static-openai-models.ts";

export interface UpstreamModels {
  readonly chat: readonly Model<any>[];
  readonly images: readonly ImageModel<ImageApi>[];
  readonly classifiers: readonly ClassifierModel<ClassifierApi>[];
  readonly reasoning: ReasoningOptionsRegistry;
}

export const loadUpstreamModels = Effect.fn("loadUpstreamModels")(function* (strict: boolean) {
  const modelsDev = yield* loadModelsDevModels(strict);
  const openRouter = yield* fetchOpenRouterModels(strict);
  return {
    chat: [...modelsDev.models, ...openRouter.chat],
    images: openRouter.images,
    classifiers: [
      ...openRouter.classifiers,
      ...OPENCODE_CLASSIFIER_MODELS,
      ...OPENAI_CLASSIFIER_MODELS,
    ],
    reasoning: modelsDev.reasoning,
  } satisfies UpstreamModels;
});
