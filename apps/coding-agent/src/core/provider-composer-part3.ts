import ai from "@msa/ai";
import compatModule from "@msa/ai/compat";
import type aiTypes from "@msa/ai/index.types";
import modelOperations from "@msa/ai/utils/model-operations";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type modelConfigTypes from "./model-config.types.ts";
import providerComposerPart1 from "./provider-composer-part1.ts";
import providerComposerPart2 from "./provider-composer-part2.ts";
import type providerComposerTypes from "./provider-composer.types.ts";

const { isModelType, lazyStream } = ai;
const { getApiProvider } = compatModule;
const { awaited, awaiting } = awaitingModule;
const { classifierErrorResult, imageErrorResult } = modelOperations;
const { applyExtension, composeApiKeyAuth, composeOAuthAuth } = providerComposerPart2;
const { applyModelOverride, applyModelsJson, getAllProviderModels } = providerComposerPart1;

function composeModelProvider(
  providerId: string,
  base: aiTypes.Provider | undefined,
  modelConfig: modelConfigTypes.ModelConfig,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): aiTypes.Provider {
  const config = modelConfig.getProvider(providerId);
  let extensionOAuthCredential: aiTypes.OAuthCredentials | undefined;
  let refreshedExtensionModels: providerComposerTypes.ProviderConfigInput["models"];
  const currentExtension = (): providerComposerTypes.ProviderConfigInput | undefined =>
    extension !== undefined && refreshedExtensionModels !== undefined
      ? { ...extension, models: refreshedExtensionModels }
      : extension;
  const getAllModels = (): aiTypes.AnyModel[] => {
    let models = applyExtension(
      providerId,
      applyModelsJson(providerId, getAllProviderModels(base), config),
      currentExtension(),
    );
    if (extensionOAuthCredential !== undefined && extension?.oauth?.modifyModels !== undefined) {
      models = [
        ...extension.oauth.modifyModels(
          models.filter((model) => isModelType(model, "chat")),
          extensionOAuthCredential,
        ),
        ...models.filter((model) => !isModelType(model, "chat")),
      ];
    }
    return models.map((model) => {
      const override = config?.modelOverrides?.[model.id];
      return override !== undefined && isModelType(model, "chat")
        ? applyModelOverride(model, override)
        : model;
    });
  };
  getAllModels();
  const apiKey = composeApiKeyAuth(providerId, base, config, extension);
  const oauth = composeOAuthAuth(providerId, base, config, extension);
  if (apiKey === undefined && oauth === undefined)
    throw new Error(`Provider ${providerId}: no authentication method configured.`);

  const supportsBaseApi = (model: aiTypes.Model<aiTypes.Api>) =>
    base?.getModels().some((entry) => entry.api === model.api) ?? false;
  const streamWith = (
    model: aiTypes.Model<aiTypes.Api>,
    context: aiTypes.TranscriptContext,
    options: aiTypes.StreamOptions | undefined,
    simple: boolean,
  ): aiTypes.AssistantMessageEventStream =>
    lazyStream(model, () =>
      Effect.runPromise(
        Effect.sync(() => {
          if (extension?.streamSimple !== undefined && model.api === extension.api) {
            return extension.streamSimple(model, context, options as aiTypes.SimpleStreamOptions);
          }
          if (base !== undefined && supportsBaseApi(model)) {
            return simple
              ? base.streamSimple(model, context, options as aiTypes.SimpleStreamOptions)
              : base.stream(model, context, options);
          }
          const api = getApiProvider(model.api);
          if (api === undefined)
            throw new Error(`No API provider registered for api: ${model.api}`);
          return simple
            ? api.streamSimple(model, context, options as aiTypes.SimpleStreamOptions)
            : api.stream(model, context, options);
        }),
      ),
    );

  const provider: aiTypes.Provider = {
    auth: {
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(oauth === undefined ? {} : { oauth }),
    },
    baseUrl: extension?.baseUrl ?? config?.baseUrl ?? base?.baseUrl,
    getAllModels,
    getModels: () => getAllModels().filter((model) => isModelType(model, "chat")),
    headers: base?.headers,
    id: providerId,
    name: extension?.name ?? config?.name ?? base?.name ?? extension?.oauth?.name ?? providerId,
    ...(base?.refreshModels !== undefined ||
    extension?.refreshModels !== undefined ||
    extension?.oauth?.modifyModels !== undefined
      ? {
          refreshModels: (context: aiTypes.RefreshModelsContext) =>
            Effect.runPromise(
              awaiting(function* () {
                yield* awaited(base?.refreshModels?.(context));
                let refreshed:
                  | NonNullable<providerComposerTypes.ProviderConfigInput["models"]>
                  | undefined;
                if (extension?.refreshModels !== undefined)
                  refreshed = yield* awaited(extension.refreshModels(context));
                if (context.signal.aborted) return;
                const oauthCredential =
                  context.credential?.type === "oauth" ? context.credential : undefined;
                yield* awaited(
                  context.publish({
                    update: () => {
                      if (refreshed !== undefined) {
                        applyExtension(
                          providerId,
                          applyModelsJson(providerId, getAllProviderModels(base), config),
                          {
                            ...extension,
                            models: refreshed,
                          },
                        );
                        refreshedExtensionModels = refreshed;
                      }
                      extensionOAuthCredential = oauthCredential;
                    },
                  }),
                );
              }),
            ),
        }
      : {}),
    ...(base?.filterModels === undefined
      ? {}
      : {
          filterModels: (
            models: readonly aiTypes.Model<aiTypes.Api>[],
            credential: aiTypes.Credential | undefined,
          ) => base.filterModels!(models, credential),
        }),
    ...(base?.filterAllModels === undefined
      ? {}
      : {
          filterAllModels: (
            models: readonly aiTypes.AnyModel[],
            credential: aiTypes.Credential | undefined,
          ) => base.filterAllModels!(models, credential),
        }),
    stream: (model, context, options) => streamWith(model, context, options, false),
    streamSimple: (model, context, options) => streamWith(model, context, options, true),
  };

  const fetchDeferred = base?.fetchDeferred;
  if (fetchDeferred !== undefined) {
    provider.fetchDeferred = (model, handle, options) => fetchDeferred(model, handle, options);
  }
  const cancelDeferred = base?.cancelDeferred;
  if (cancelDeferred !== undefined) {
    provider.cancelDeferred = (model, handle, options) => cancelDeferred(model, handle, options);
  }
  const countTokens = base?.countTokens;
  if (countTokens !== undefined) {
    provider.countTokens = (model, context, options) => {
      if (
        (extension?.streamSimple && model.api === extension.api) === true ||
        !supportsBaseApi(model)
      ) {
        throw new Error(`Provider ${providerId} cannot count tokens for "${model.api}"`);
      }
      return countTokens(model, context, options);
    };
  }
  const extensionImages = extension?.images;
  const generateImages = base?.generateImages;
  if (generateImages !== undefined || Object.keys(extensionImages ?? {}).length > 0) {
    provider.generateImages = (model, context, options) => {
      const implementation = extensionImages?.[model.api];
      if (implementation !== undefined)
        return implementation.generateImages(model, context, options);
      if (generateImages !== undefined) return generateImages(model, context, options);
      return Promise.resolve(
        imageErrorResult(
          model,
          new Error(`Provider ${providerId} has no image implementation for "${model.api}"`),
        ),
      );
    };
  }
  const extensionClassifiers = extension?.classifiers;
  const classify = base?.classify;
  if (classify !== undefined || Object.keys(extensionClassifiers ?? {}).length > 0) {
    provider.classify = (model, context, options) => {
      const implementation = extensionClassifiers?.[model.api];
      if (implementation !== undefined) return implementation.classify(model, context, options);
      if (classify !== undefined) return classify(model, context, options);
      return Promise.resolve(
        classifierErrorResult(
          model,
          new Error(`Provider ${providerId} has no classifier implementation for "${model.api}"`),
        ),
      );
    };
  }

  return provider;
}

const providerComposerPart3 = {
  composeModelProvider,
};

export default providerComposerPart3;
