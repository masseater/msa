import { Effect } from "effect";

import loadModelsDevModels from "./models-dev-catalog.ts";
import remoteCatalogs from "./remote-catalogs.ts";
import staticModels from "./static-models.ts";
import staticOpenaiModels from "./static-openai-models.ts";
import type upstreamModelsTypes from "./upstream-models.types.ts";
import type upstreamTypes from "./upstream.types.ts";

const { fetchOpenRouterModels } = remoteCatalogs;
const { OPENCODE_CLASSIFIER_MODELS } = staticModels;
const { OPENAI_CLASSIFIER_MODELS } = staticOpenaiModels;

const loadUpstreamModels: (
  strict: boolean,
) => Effect.Effect<upstreamModelsTypes.UpstreamModels, upstreamTypes.UpstreamError> = Effect.fn(
  "loadUpstreamModels",
)(function* (strict: boolean) {
  const modelsDev = yield* loadModelsDevModels(strict);
  const openRouter = yield* fetchOpenRouterModels(strict);
  return {
    chat: [...modelsDev.models, ...openRouter.chat],
    classifiers: [
      ...openRouter.classifiers,
      ...OPENCODE_CLASSIFIER_MODELS,
      ...OPENAI_CLASSIFIER_MODELS,
    ],
    images: openRouter.images,
    reasoning: modelsDev.reasoning,
  } satisfies upstreamModelsTypes.UpstreamModels;
});

export default loadUpstreamModels;
