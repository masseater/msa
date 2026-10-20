import type typesModule from "../auth/types.ts";
import type modelsStoreTypes from "../models-store.types.ts";
import type typesModuleModule from "../types.types.ts";

declare namespace providerTypesModule {
  interface ModelsPublication {
    persist?: modelsStoreTypes.ModelsStoreEntry | null;
    update?: () => void;
  }

  interface RefreshModelsContext {
    credential?: typesModule.Credential | undefined;
    stored?: Readonly<modelsStoreTypes.ModelsStoreEntry> | undefined;
    publish(publication: ModelsPublication): Promise<boolean>;
    allowNetwork: boolean;
    force?: boolean | undefined;
    signal: AbortSignal;
    baseUrl?: string | undefined;
  }

  type ProviderModel<TApi extends typesModuleModule.Api> =
    | typesModuleModule.Model<TApi>
    | typesModuleModule.ImageModel<typesModuleModule.ImageApi>
    | typesModuleModule.ClassifierModel<typesModuleModule.ClassifierApi>;

  interface Provider<TApi extends typesModuleModule.Api = typesModuleModule.Api> {
    readonly id: string;
    readonly name: string;

    readonly baseUrl?: string | undefined;
    readonly headers?: typesModuleModule.ProviderHeaders | undefined;

    readonly auth: typesModule.ProviderAuth;

    getModels(): readonly typesModuleModule.Model<TApi>[];

    getAllModels?(): readonly ProviderModel<TApi>[];

    refreshModels?(context: RefreshModelsContext): Promise<void>;

    filterModels?(
      models: readonly typesModuleModule.Model<TApi>[],
      credential: typesModule.Credential | undefined,
    ): readonly typesModuleModule.Model<TApi>[];

    filterAllModels?(
      models: readonly ProviderModel<TApi>[],
      credential: typesModule.Credential | undefined,
    ): readonly ProviderModel<TApi>[];

    stream<T extends TApi>(
      model: typesModuleModule.Model<T>,
      context: typesModuleModule.TranscriptContext,
      options?: typesModuleModule.ApiStreamOptions<T>,
    ): typesModuleModule.AssistantMessageEventStream;

    streamSimple(
      model: typesModuleModule.Model<TApi>,
      context: typesModuleModule.TranscriptContext,
      options?: typesModuleModule.SimpleStreamOptions,
    ): typesModuleModule.AssistantMessageEventStream;
    fetchDeferred?(
      model: typesModuleModule.Model<TApi>,
      handle: typesModuleModule.DeferredHandle,
      options?: typesModuleModule.DeferredFetchOptions,
    ): typesModuleModule.AssistantMessageEventStream;
    cancelDeferred?(
      model: typesModuleModule.Model<TApi>,
      handle: typesModuleModule.DeferredHandle,
      options?: typesModuleModule.DeferredCancelOptions,
    ): Promise<void>;
    countTokens?(
      model: typesModuleModule.Model<TApi>,
      context: typesModuleModule.TranscriptContext,
      options?: typesModuleModule.SimpleStreamOptions,
    ): Promise<number>;

    generateImages?(
      model: typesModuleModule.ImageModel<typesModuleModule.ImageApi>,
      context: typesModuleModule.ImagesContext,
      options?: typesModuleModule.ImagesOptions,
    ): Promise<typesModuleModule.AssistantImages>;

    classify?(
      model: typesModuleModule.ClassifierModel<typesModuleModule.ClassifierApi>,
      context: typesModuleModule.ClassifierContext,
      options?: typesModuleModule.ClassifierOptions,
    ): Promise<typesModuleModule.ClassifierResult>;
  }
}

export type { providerTypesModule as default };
