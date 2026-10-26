import ai from "@msa/ai";
import compatModule from "@msa/ai/compat";
import type aiTypes from "@msa/ai/index.types";
import modelOperations from "@msa/ai/utils/model-operations";
import * as Effect from "effect/Effect";

import type ComposedProvider from "./composed-provider.ts";

const { classifierErrorResult, imageErrorResult } = modelOperations;
const { lazyStream } = ai;
const { getApiProvider } = compatModule;

const attachDeferred = (composed: ComposedProvider, provider: aiTypes.Provider): void => {
  const fetchDeferred = composed.base?.fetchDeferred;
  if (fetchDeferred !== undefined) {
    provider.fetchDeferred = (model, handle, options) => fetchDeferred(model, handle, options);
  }
  const cancelDeferred = composed.base?.cancelDeferred;
  if (cancelDeferred !== undefined) {
    provider.cancelDeferred = (model, handle, options) => cancelDeferred(model, handle, options);
  }
};

const attachTokenCounting = (composed: ComposedProvider, provider: aiTypes.Provider): void => {
  const { extension, providerId } = composed;
  const countTokens = composed.base?.countTokens;
  if (countTokens === undefined) return;
  provider.countTokens = (model, context, options) => {
    if (
      (extension?.streamSimple && model.api === extension.api) === true ||
      !composed.supportsBaseApi(model)
    ) {
      throw new Error(`Provider ${providerId} cannot count tokens for "${model.api}"`);
    }
    return countTokens(model, context, options);
  };
};

const attachImages = (composed: ComposedProvider, provider: aiTypes.Provider): void => {
  const { providerId } = composed;
  const extensionImages = new Map(Object.entries(composed.extension?.images ?? {}));
  const generateImages = composed.base?.generateImages;
  if (generateImages === undefined && extensionImages.size === 0) return;
  provider.generateImages = (model, context, options) => {
    const implementation = extensionImages.get(model.api);
    if (implementation !== undefined) return implementation.generateImages(model, context, options);
    if (generateImages !== undefined) return generateImages(model, context, options);
    return Promise.resolve(
      imageErrorResult(
        model,
        new Error(`Provider ${providerId} has no image implementation for "${model.api}"`),
      ),
    );
  };
};

const attachClassifiers = (composed: ComposedProvider, provider: aiTypes.Provider): void => {
  const { providerId } = composed;
  const extensionClassifiers = new Map(Object.entries(composed.extension?.classifiers ?? {}));
  const classify = composed.base?.classify;
  if (classify === undefined && extensionClassifiers.size === 0) return;
  provider.classify = (model, context, options) => {
    const implementation = extensionClassifiers.get(model.api);
    if (implementation !== undefined) return implementation.classify(model, context, options);
    if (classify !== undefined) return classify(model, context, options);
    return Promise.resolve(
      classifierErrorResult(
        model,
        new Error(`Provider ${providerId} has no classifier implementation for "${model.api}"`),
      ),
    );
  };
  const prepareClassifier = composed.base?.prepareClassifier;
  provider.prepareClassifier = (model) => {
    const implementation = extensionClassifiers.get(model.api);
    if (implementation !== undefined)
      return implementation.prepare?.(model) ?? Promise.resolve({ fetched: false });
    return prepareClassifier?.(model) ?? Promise.resolve({ fetched: false });
  };
};

const streamThrough = (
  composed: ComposedProvider,
  model: aiTypes.Model<aiTypes.Api>,
  context: aiTypes.TranscriptContext,
  options: aiTypes.StreamOptions | undefined,
  simple: boolean,
): aiTypes.AssistantMessageEventStream => {
  const { base, extension } = composed;
  return lazyStream(model, () =>
    Effect.runPromise(
      Effect.sync(() => {
        if (extension?.streamSimple !== undefined && model.api === extension.api) {
          return extension.streamSimple(model, context, options as aiTypes.SimpleStreamOptions);
        }
        if (base !== undefined && composed.supportsBaseApi(model)) {
          return simple
            ? base.streamSimple(model, context, options as aiTypes.SimpleStreamOptions)
            : base.stream(model, context, options);
        }
        const api = getApiProvider(model.api);
        if (api === undefined) throw new Error(`No API provider registered for api: ${model.api}`);
        return simple
          ? api.streamSimple(model, context, options as aiTypes.SimpleStreamOptions)
          : api.stream(model, context, options);
      }),
    ),
  );
};

const attachCapabilities = (composed: ComposedProvider, provider: aiTypes.Provider): void => {
  attachDeferred(composed, provider);
  attachTokenCounting(composed, provider);
  attachImages(composed, provider);
  attachClassifiers(composed, provider);
};

const providerCapabilities = { attachCapabilities, streamThrough };

export default providerCapabilities;
