import type compatTypes from "./compat.types.ts";
import type modelsStoreTypes from "./models-store.types.ts";
import type modelsTypes from "./models.types.ts";
import type providerTypesModule from "./models/provider-types.ts";
import type typesTypes2 from "./models/types.ts";
import type fauxMessagesTypes from "./providers/faux-messages.types.ts";
import type fauxTypesModule from "./providers/faux-types.ts";
import type sessionResourcesTypes from "./session-resources.types.ts";
import type modelsErrorTypes from "./utils/models-error.types.ts";

declare namespace compatTypesPart3 {
  type ModelsErrorCode = modelsErrorTypes.ModelsErrorCode;
  type ModelsPublication = providerTypesModule.ModelsPublication;
  type Provider<TApi extends compatTypes.Api = compatTypes.Api> =
    providerTypesModule.Provider<TApi>;
  type RefreshModelsContext = providerTypesModule.RefreshModelsContext;
  type CreateModelsOptions = typesTypes2.CreateModelsOptions;
  type Models = typesTypes2.Models;
  type ModelsApiStreamOptions<TApi extends compatTypes.Api> =
    typesTypes2.ModelsApiStreamOptions<TApi>;
  type ModelsClassifierOptions = typesTypes2.ModelsClassifierOptions;
  type ModelsDeferredCancelOptions = typesTypes2.ModelsDeferredCancelOptions;
  type ModelsDeferredFetchOptions = typesTypes2.ModelsDeferredFetchOptions;
  type ModelsImagesOptions = typesTypes2.ModelsImagesOptions;
  type ModelsRefreshOptions = typesTypes2.ModelsRefreshOptions;
  type ModelsRefreshResult = typesTypes2.ModelsRefreshResult;
  type ModelsRequestTransforms = typesTypes2.ModelsRequestTransforms;
  type ModelsSimpleStreamOptions = typesTypes2.ModelsSimpleStreamOptions;
  type MutableModels = typesTypes2.MutableModels;
  type CreateProviderOptions<TApi extends compatTypes.Api = compatTypes.Api> =
    modelsTypes.CreateProviderOptions<TApi>;
  type ModelsStoreEntry = modelsStoreTypes.ModelsStoreEntry;
  type ModelsStoreOperationOptions = modelsStoreTypes.ModelsStoreOperationOptions;
  type ModelsStore = modelsStoreTypes.ModelsStore;
  type FauxContentBlock = fauxMessagesTypes.FauxContentBlock;
  type FauxModelDefinition = fauxTypesModule.FauxModelDefinition;
  type FauxProviderHandle = fauxTypesModule.FauxProviderHandle;
  type FauxProviderRegistration = fauxTypesModule.FauxProviderRegistration;
  type FauxProviderState = fauxTypesModule.FauxProviderState;
  type FauxResponseFactory = fauxTypesModule.FauxResponseFactory;
  type FauxResponseStep = fauxTypesModule.FauxResponseStep;
  type RegisterFauxProviderOptions = fauxTypesModule.RegisterFauxProviderOptions;
  type SessionResourceCleanup = sessionResourcesTypes.SessionResourceCleanup;
  type ModelsError = modelsErrorTypes.ModelsError;
  type InMemoryModelsStore = modelsStoreTypes.InMemoryModelsStore;
}

export type { compatTypesPart3 as default };
