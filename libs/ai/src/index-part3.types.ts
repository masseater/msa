import type aiTypes from "./index.types.ts";
import type modelsStoreTypes from "./models-store.types.ts";
import type modelsTypes from "./models.types.ts";
import type compatFieldsSchemaTypes from "./providers/compat-fields-schema.types.ts";
import type compatSchemaTypes from "./providers/compat-schema.types.ts";
import type fauxMessagesTypes from "./providers/faux-messages.types.ts";
import type fauxTypesModule from "./providers/faux-types.ts";
import type modelSchemaTypes from "./providers/model-schema.types.ts";
import type sessionResourcesTypes from "./session-resources.types.ts";

declare namespace aiTypesPart3 {
  type CreateProviderOptions<TApi extends aiTypes.Api = aiTypes.Api> =
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
  type ChatTemplateKwargValue = compatFieldsSchemaTypes.ChatTemplateKwargValue;
  type SessionAffinityFormat = compatFieldsSchemaTypes.SessionAffinityFormat;
  type ThinkingTokenBudgetField = compatFieldsSchemaTypes.ThinkingTokenBudgetField;
  type AnthropicMessagesCompat = compatSchemaTypes.AnthropicMessagesCompat;
  type CacheRetention = modelSchemaTypes.CacheRetention;
  type ModelCost = modelSchemaTypes.ModelCost;
  type ModelCostRates = modelSchemaTypes.ModelCostRates;
  type ModelCostTier = modelSchemaTypes.ModelCostTier;
  type ModelImageInputLimits = modelSchemaTypes.ModelImageInputLimits;
  type ModelImageResizeOptions = modelSchemaTypes.ModelImageResizeOptions;
  type ModelInputLimits = modelSchemaTypes.ModelInputLimits;
  type ModelInputModality = modelSchemaTypes.ModelInputModality;
  type ModelPromptCache = modelSchemaTypes.ModelPromptCache;
  type ModelThinkingLevel = modelSchemaTypes.ModelThinkingLevel;
  type ThinkingLevel = modelSchemaTypes.ThinkingLevel;
  type ThinkingLevelMap = modelSchemaTypes.ThinkingLevelMap;
  type InMemoryModelsStore = modelsStoreTypes.InMemoryModelsStore;
}

export type { aiTypesPart3 as default };
