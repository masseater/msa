import type aiTypes from "../index.types.ts";
import type modelTypesModule from "../model-types.ts";
import type modelsStoreTypes from "../models-store.types.ts";
import type modelsTypes from "../models.types.ts";
import type providerTypesModule from "../models/provider-types.ts";
import type typesTypes2 from "../models/types.ts";
import type providerApiTypesModule from "../provider-api-types.ts";
import type sessionResourcesTypes from "../session-resources.types.ts";
import type modelsErrorTypes from "../utils/models-error.types.ts";

declare namespace aiModelsKitTypes {
  type ModelsErrorCode = modelsErrorTypes.ModelsErrorCode;
  type ModelsPublication = providerTypesModule.ModelsPublication;
  type Provider<TApi extends aiTypes.Api = aiTypes.Api> = providerTypesModule.Provider<TApi>;
  type RefreshModelsContext = providerTypesModule.RefreshModelsContext;
  type CreateModelsOptions = typesTypes2.CreateModelsOptions;
  type Models = typesTypes2.Models;
  type ModelsApiStreamOptions<TApi extends aiTypes.Api> = typesTypes2.ModelsApiStreamOptions<TApi>;
  type ModelsClassifierOptions = typesTypes2.ModelsClassifierOptions;
  type ModelsDeferredCancelOptions = typesTypes2.ModelsDeferredCancelOptions;
  type ModelsDeferredFetchOptions = typesTypes2.ModelsDeferredFetchOptions;
  type ModelsImagesOptions = typesTypes2.ModelsImagesOptions;
  type ModelsRefreshOptions = typesTypes2.ModelsRefreshOptions;
  type ModelsRefreshResult = typesTypes2.ModelsRefreshResult;
  type ModelsRequestTransforms = typesTypes2.ModelsRequestTransforms;
  type ModelsSimpleStreamOptions = typesTypes2.ModelsSimpleStreamOptions;
  type MutableModels = typesTypes2.MutableModels;
  type ModelsError = modelsErrorTypes.ModelsError;
  type CreateProviderOptions<TApi extends aiTypes.Api = aiTypes.Api> =
    modelsTypes.CreateProviderOptions<TApi>;
  type ModelsStoreEntry = modelsStoreTypes.ModelsStoreEntry;
  type ModelsStoreOperationOptions = modelsStoreTypes.ModelsStoreOperationOptions;
  type ModelsStore = modelsStoreTypes.ModelsStore;
  type SessionResourceCleanup = sessionResourcesTypes.SessionResourceCleanup;
  type InMemoryModelsStore = modelsStoreTypes.InMemoryModelsStore;
  type AnyModel = modelTypesModule.AnyModel;
  type BaseModel<TApi extends string> = modelTypesModule.BaseModel<TApi>;
  type ClassifierModel<TApi extends aiTypes.ClassifierApi> = modelTypesModule.ClassifierModel<TApi>;
  type ImageModel<TApi extends aiTypes.ImageApi> = modelTypesModule.ImageModel<TApi>;
  type Model<TApi extends aiTypes.Api> = modelTypesModule.Model<TApi>;
  type ModelType = modelTypesModule.ModelType;
  type ModelTypeMap = modelTypesModule.ModelTypeMap;
  type ClassifierFunction<TOptions extends aiTypes.ClassifierOptions = aiTypes.ClassifierOptions> =
    providerApiTypesModule.ClassifierFunction<TOptions>;
  type ClassifierOptions = providerApiTypesModule.ClassifierOptions;
  type ImagesFunction<TOptions extends aiTypes.ImagesOptions = aiTypes.ImagesOptions> =
    providerApiTypesModule.ImagesFunction<TOptions>;
  type ImagesOptions = providerApiTypesModule.ImagesOptions;
  type ProviderClassifier = providerApiTypesModule.ProviderClassifier;
  type ProviderImages = providerApiTypesModule.ProviderImages;
  type ProviderImagesOptions = providerApiTypesModule.ProviderImagesOptions;
  type ProviderStreams = providerApiTypesModule.ProviderStreams;
  type StreamFunction<
    TApi extends aiTypes.Api = aiTypes.Api,
    TOptions extends aiTypes.StreamOptions = aiTypes.StreamOptions,
  > = providerApiTypesModule.StreamFunction<TApi, TOptions>;
}

export type { aiModelsKitTypes as default };
