import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type modelConfigTypes from "../model-config.types.ts";
import type providerComposerTypes from "../provider-composer.types.ts";
import apiKeyAuth from "./api-key-auth.ts";
import modelOverrides from "./model-overrides.ts";
import providerCapabilities from "./provider-capabilities.ts";
import providerModels from "./provider-models.ts";

const { isModelType } = ai;
const { awaited, awaiting } = awaitingModule;
const { applyExtension, applyModelsJson, getAllProviderModels } = providerModels;
const { applyModelOverride } = modelOverrides;
const { composeAuth } = apiKeyAuth;
const { attachCapabilities, streamThrough } = providerCapabilities;

type Extension = providerComposerTypes.ProviderConfigInput;

export default class ComposedProvider {
  readonly providerId: string;

  readonly base: aiTypes.Provider | undefined;

  readonly extension: Extension | undefined;

  private readonly config: modelConfigTypes.ModelsJsonProvider | undefined;

  private extensionOAuthCredential: aiTypes.OAuthCredentials | undefined;

  private refreshedExtensionModels: Extension["models"];

  constructor(
    providerId: string,
    base: aiTypes.Provider | undefined,
    modelConfig: modelConfigTypes.ModelConfig,
    extension: Extension | undefined,
  ) {
    this.providerId = providerId;
    this.base = base;
    this.extension = extension;
    this.config = modelConfig.getProvider(providerId);
  }

  build(): aiTypes.Provider {
    const { providerId, base, config, extension } = this;
    this.getAllModels();
    const { apiKey, oauth } = composeAuth(providerId, base, config, extension);
    if (apiKey === undefined && oauth === undefined)
      throw new Error(`Provider ${providerId}: no authentication method configured.`);
    const provider: aiTypes.Provider = {
      auth: {
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(oauth === undefined ? {} : { oauth }),
      },
      baseUrl: extension?.baseUrl ?? config?.baseUrl ?? base?.baseUrl,
      getAllModels: () => this.getAllModels(),
      getModels: () => this.getAllModels().filter((model) => isModelType(model, "chat")),
      headers: base?.headers,
      id: providerId,
      name: extension?.name ?? config?.name ?? base?.name ?? extension?.oauth?.name ?? providerId,
      ...(base?.refreshModels !== undefined ||
      extension?.refreshModels !== undefined ||
      extension?.oauth?.modifyModels !== undefined
        ? { refreshModels: (context: aiTypes.RefreshModelsContext) => this.refreshModels(context) }
        : {}),
      ...this.modelFilters(),
      stream: (model, context, options) => streamThrough(this, model, context, options, false),
      streamSimple: (model, context, options) => streamThrough(this, model, context, options, true),
    };
    attachCapabilities(this, provider);
    return provider;
  }

  supportsBaseApi(model: aiTypes.Model<aiTypes.Api>): boolean {
    return this.base?.getModels().some((entry) => entry.api === model.api) ?? false;
  }

  private currentExtension(): Extension | undefined {
    const { extension, refreshedExtensionModels } = this;
    return extension !== undefined && refreshedExtensionModels !== undefined
      ? { ...extension, models: refreshedExtensionModels }
      : extension;
  }

  private getAllModels(): aiTypes.AnyModel[] {
    const { providerId, base, config, extension, extensionOAuthCredential } = this;
    let models = applyExtension(
      providerId,
      applyModelsJson(providerId, getAllProviderModels(base), config),
      this.currentExtension(),
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
    const overrides = new Map(Object.entries(config?.modelOverrides ?? {}));
    return models.map((model) => {
      const override = overrides.get(model.id);
      return override !== undefined && isModelType(model, "chat")
        ? applyModelOverride(model, override)
        : model;
    });
  }

  private refreshModels(context: aiTypes.RefreshModelsContext): Promise<void> {
    return Effect.runPromise(awaiting(() => this.refreshModelsSteps(context)));
  }

  private *refreshModelsSteps(context: aiTypes.RefreshModelsContext) {
    const { providerId, base, config, extension } = this;
    yield* awaited(base?.refreshModels?.(context));
    let refreshed: NonNullable<Extension["models"]> | undefined;
    if (extension?.refreshModels !== undefined) {
      refreshed = yield* awaited(extension.refreshModels(context));
    }
    if (context.signal.aborted) return;
    const oauthCredential = context.credential?.type === "oauth" ? context.credential : undefined;
    yield* awaited(
      context.publish({
        update: () => {
          if (refreshed !== undefined) {
            applyExtension(
              providerId,
              applyModelsJson(providerId, getAllProviderModels(base), config),
              { ...extension, models: refreshed },
            );
            this.refreshedExtensionModels = refreshed;
          }
          this.extensionOAuthCredential = oauthCredential;
        },
      }),
    );
  }

  private modelFilters(): Pick<aiTypes.Provider, "filterModels" | "filterAllModels"> {
    const { base } = this;
    return {
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
    };
  }
}
