import type authTypes from "./auth/types.ts";
import type providerTypesModule from "./models/provider-types.ts";
import type typesTypes from "./models/types.ts";
import type typesModule from "./types.types.ts";
import type modelsErrorTypes from "./utils/models-error.types.ts";

declare namespace modelsTypes {
  interface CreateProviderOptions<TApi extends typesModule.Api = typesModule.Api> {
    id: string;
    name?: string | undefined;
    baseUrl?: string | undefined;
    headers?: typesModule.ProviderHeaders | undefined;
    auth: authTypes.ProviderAuth;
    models: readonly providerTypesModule.ProviderModel<TApi>[];
    fetchModels?:
      | ((
          context: providerTypesModule.RefreshModelsContext,
        ) => Promise<readonly providerTypesModule.ProviderModel<TApi>[]>)
      | undefined;
    filterModels?: (
      models: readonly typesModule.Model<TApi>[],
      credential: authTypes.Credential | undefined,
    ) => readonly typesModule.Model<TApi>[];
    filterAllModels?: (
      models: readonly providerTypesModule.ProviderModel<TApi>[],
      credential: authTypes.Credential | undefined,
    ) => readonly providerTypesModule.ProviderModel<TApi>[];
    api?:
      | typesModule.ProviderStreams
      | Partial<Record<TApi, typesModule.ProviderStreams>>
      | undefined;
    images?: Partial<Record<typesModule.ImageApi, typesModule.ProviderImages>> | undefined;
    classifiers?:
      | Partial<Record<typesModule.ClassifierApi, typesModule.ProviderClassifier>>
      | undefined;
  }

  type ModelsErrorCode = modelsErrorTypes.ModelsErrorCode;

  type ModelsPublication = providerTypesModule.ModelsPublication;

  type Provider<TApi extends typesModule.Api = typesModule.Api> =
    providerTypesModule.Provider<TApi>;

  type RefreshModelsContext = providerTypesModule.RefreshModelsContext;

  type CreateModelsOptions = typesTypes.CreateModelsOptions;

  type Models = typesTypes.Models;

  type ModelsApiStreamOptions<TApi extends typesModule.Api> =
    typesTypes.ModelsApiStreamOptions<TApi>;

  type ModelsClassifierOptions = typesTypes.ModelsClassifierOptions;

  type ModelsDeferredCancelOptions = typesTypes.ModelsDeferredCancelOptions;

  type ModelsDeferredFetchOptions = typesTypes.ModelsDeferredFetchOptions;

  type ModelsImagesOptions = typesTypes.ModelsImagesOptions;

  type ModelsRefreshOptions = typesTypes.ModelsRefreshOptions;

  type ModelsRefreshResult = typesTypes.ModelsRefreshResult;

  type ModelsRequestTransforms = typesTypes.ModelsRequestTransforms;

  type ModelsSimpleStreamOptions = typesTypes.ModelsSimpleStreamOptions;

  type MutableModels = typesTypes.MutableModels;

  type ModelsError = modelsErrorTypes.ModelsError;
}

export type { modelsTypes as default };
