import type apiProviderRegistryTypes from "./api-provider-registry.types.ts";
import type anthropicMessagesCompatTypes from "./api/anthropic-messages-compat.types.ts";
import type anthropicMessagesOptionsTypes from "./api/anthropic-messages-options.ts";
import type googleGenerativeAiTypes from "./api/google-generative-ai.types.ts";
import type googleThinkingTypes from "./api/google-thinking.types.ts";
import type compatTypes from "./compat.types.ts";
import type imageModelsTypes from "./image-models.types.ts";
import type imagesApiRegistryTypes from "./images-api-registry.types.ts";
import type allTypes from "./providers/all.types.ts";

declare namespace compatTypesPart1 {
  type ApiProvider<
    TApi extends compatTypes.Api = compatTypes.Api,
    TOptions extends compatTypes.StreamOptions = compatTypes.StreamOptions,
  > = apiProviderRegistryTypes.ApiProvider<TApi, TOptions>;
  type ApiStreamFunction = apiProviderRegistryTypes.ApiStreamFunction;
  type ApiStreamSimpleFunction = apiProviderRegistryTypes.ApiStreamSimpleFunction;
  type BuiltinProvider = allTypes.BuiltinProvider;
  type BuiltinImageProvider = imageModelsTypes.BuiltinImageProvider;
  type ImagesApiFunction = imagesApiRegistryTypes.ImagesApiFunction;
  type ImagesApiProvider<
    TApi extends compatTypes.ImageApi = compatTypes.ImageApi,
    TOptions extends compatTypes.ImagesOptions = compatTypes.ImagesOptions,
  > = imagesApiRegistryTypes.ImagesApiProvider<TApi, TOptions>;
  type AnthropicEffort = anthropicMessagesCompatTypes.AnthropicEffort;
  type AnthropicOptions = anthropicMessagesOptionsTypes.AnthropicOptions;
  type AnthropicThinkingDisplay = anthropicMessagesCompatTypes.AnthropicThinkingDisplay;
  type GoogleOptions = googleGenerativeAiTypes.GoogleOptions;
  type GoogleApiThinkingLevel = googleThinkingTypes.GoogleApiThinkingLevel;
  type ResolvedGoogleThinkingLevel = googleThinkingTypes.ResolvedGoogleThinkingLevel;
}

export type { compatTypesPart1 as default };
