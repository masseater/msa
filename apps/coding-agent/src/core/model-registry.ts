import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import { awaited, awaitingWith } from "./awaiting.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import type { AuthStatus, ProviderConfigInput } from "./provider-composer.ts";
import type { VirtualModelDefinition } from "./virtual-models.ts";

export { clearApiKeyCache } from "./provider-composer.ts";
export type { ProviderConfigInput } from "./provider-composer.ts";
export type ResolvedRequestAuth =
  | {
      ok: true;
      apiKey?: string | undefined;
      headers?: aiTypes.ProviderHeaders | undefined;
      baseUrl?: string | undefined;
      env?: Record<string, string> | undefined;
    }
  | { ok: false; error: string };

export class ModelRegistry {
  private readonly runtime: ModelRuntime;

  constructor(runtime: ModelRuntime) {
    this.runtime = runtime;
  }

  refresh(options?: aiTypes.ModelsRefreshOptions): Promise<aiTypes.ModelsRefreshResult> {
    return this.runtime.refresh(options);
  }

  getError(): string | undefined {
    return this.runtime.getError();
  }

  getAll(): aiTypes.Model<aiTypes.Api>[] {
    return [...this.runtime.getModels()];
  }

  getAvailable(): aiTypes.Model<aiTypes.Api>[] {
    return [...this.runtime.getAvailableSnapshot()];
  }

  find(provider: string, modelId: string): aiTypes.Model<aiTypes.Api> | undefined {
    return this.runtime.getModel(provider, modelId);
  }

  findOfType<TType extends aiTypes.ModelType>(
    type: TType,
    provider: string,
    modelId: string,
  ): aiTypes.ModelTypeMap[TType] | undefined {
    return this.runtime.getModelOfType(type, provider, modelId);
  }

  hasConfiguredAuth(model: aiTypes.Model<aiTypes.Api>): boolean {
    return this.runtime.hasConfiguredAuth(model.provider);
  }

  getApiKeyAndHeaders(model: aiTypes.Model<aiTypes.Api>): Promise<ResolvedRequestAuth> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          const resolution = yield* awaited(this.runtime.getAuth(model));
          if (resolution === undefined) {
            const compatibility = this.runtime.getCompatibilityRequestConfig(model);
            if (compatibility.authHeader) {
              return { error: `No API key found for "${model.provider}"`, ok: false };
            }
            return { headers: compatibility.headers, ok: true };
          }
          return {
            ok: true,
            apiKey: resolution.auth.apiKey,
            headers: resolution.auth.headers,
            ...(resolution.auth.baseUrl !== undefined && resolution.auth.baseUrl !== ""
              ? { baseUrl: resolution.auth.baseUrl }
              : {}),
            env: resolution.env,
          };
        } catch (error) {
          const cause = error instanceof Error ? error.cause : undefined;
          const message =
            cause instanceof Error
              ? cause.message
              : error instanceof Error
                ? error.message
                : String(error);
          return {
            error:
              message === "authHeader requires a resolved API key"
                ? `No API key found for "${model.provider}"`
                : message,
            ok: false,
          };
        }
      }, this),
    );
  }

  getProviderAuthStatus(provider: string): AuthStatus {
    return this.runtime.getProviderAuthStatus(provider);
  }

  getProvider(provider: string): aiTypes.Provider | undefined {
    return this.runtime.getProvider(provider);
  }

  stream<TApi extends aiTypes.Api>(
    model: aiTypes.Model<TApi>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsApiStreamOptions<TApi>,
  ): aiTypes.AssistantMessageEventStream {
    return this.runtime.stream(model, context, options);
  }

  streamSimple(
    model: aiTypes.Model<aiTypes.Api>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ): aiTypes.AssistantMessageEventStream {
    return this.runtime.streamSimple(model, context, options);
  }

  complete<TApi extends aiTypes.Api>(
    model: aiTypes.Model<TApi>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsApiStreamOptions<TApi>,
  ): Promise<aiTypes.AssistantMessage> {
    return this.runtime.complete(model, context, options);
  }

  getModelsOfType<TType extends aiTypes.ModelType>(
    type: TType,
    provider?: string,
  ): readonly aiTypes.ModelTypeMap[TType][] {
    return this.runtime.getModelsOfType(type, provider);
  }

  getAvailableOfType<TType extends aiTypes.ModelType>(
    type: TType,
    provider?: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<readonly aiTypes.ModelTypeMap[TType][]> {
    return this.runtime.getAvailableOfType(type, provider, options);
  }

  getModelOfType<TType extends aiTypes.ModelType>(
    type: TType,
    provider: string,
    modelId: string,
  ): aiTypes.ModelTypeMap[TType] | undefined {
    return this.runtime.getModelOfType(type, provider, modelId);
  }

  classify(
    model: aiTypes.ClassifierModel<aiTypes.ClassifierApi>,
    context: aiTypes.ClassifierContext,
    options?: aiTypes.ModelsClassifierOptions,
  ): Promise<aiTypes.ClassifierResult> {
    return this.runtime.classify(model, context, options);
  }

  generateImages(
    model: aiTypes.ImageModel<aiTypes.ImageApi>,
    context: aiTypes.ImagesContext,
    options?: aiTypes.ModelsImagesOptions,
  ): Promise<aiTypes.AssistantImages> {
    return this.runtime.generateImages(model, context, options);
  }

  getProviderDisplayName(provider: string): string {
    return this.runtime.getProvider(provider)?.name ?? provider;
  }

  getProviderAuth(provider: string): Promise<aiTypes.AuthResult | undefined> {
    return this.runtime.getAuth(provider);
  }

  getApiKeyForProvider(provider: string): Promise<string | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          return (yield* awaited(this.runtime.getAuth(provider)))?.auth.apiKey;
        } catch {
          return undefined;
        }
      }, this),
    );
  }

  isUsingOAuth(model: aiTypes.Model<aiTypes.Api>): boolean {
    return this.runtime.isUsingOAuth(model.provider);
  }

  registerProvider(provider: aiTypes.Provider): void;
  registerProvider(providerName: string, config: ProviderConfigInput): void;
  registerProvider(providerOrName: aiTypes.Provider | string, config?: ProviderConfigInput): void {
    if (typeof providerOrName === "string") {
      if (config === undefined)
        throw new Error("Provider config is required when registering by name");
      this.runtime.registerProvider(providerOrName, config);
      return;
    }
    this.runtime.registerNativeProvider(providerOrName);
  }

  unregisterProvider(providerName: string): void {
    this.runtime.unregisterProvider(providerName);
  }

  registerVirtualModel(definition: VirtualModelDefinition): void {
    this.runtime.registerVirtualModel(definition);
  }

  unregisterVirtualModel(providerName: string, id: string): void {
    this.runtime.unregisterVirtualModel(providerName, id);
  }

  getRegisteredProviderConfig(providerName: string): ProviderConfigInput | undefined {
    return this.runtime.getRegisteredProviderConfig(providerName);
  }

  getRegisteredNativeProvider(providerName: string): aiTypes.Provider | undefined {
    return this.runtime.getRegisteredNativeProvider(providerName);
  }

  getRegisteredProviderIds(): readonly string[] {
    return this.runtime.getRegisteredProviderIds();
  }
}
