import type aiTypes from "@msa/ai/index.types";

declare namespace providerComposerTypes {
  interface ExtensionOAuthConfig {
    name: string;
    isSubscription?: boolean;
    usesCallbackServer?: boolean;
    login(callbacks: aiTypes.OAuthLoginCallbacks): Promise<aiTypes.OAuthCredentials>;
    refreshToken(
      credentials: aiTypes.OAuthCredentials,
      signal: AbortSignal,
    ): Promise<aiTypes.OAuthCredentials>;
    getApiKey(credentials: aiTypes.OAuthCredentials): string;
    modifyModels?(
      models: aiTypes.Model<aiTypes.Api>[],
      credentials: aiTypes.OAuthCredentials,
    ): aiTypes.Model<aiTypes.Api>[];
  }

  interface ProviderModelConfigBase {
    id: string;
    name: string;
    api?: string;
    baseUrl?: string;
    input: ("text" | "image")[];
    inputLimits?: NonNullable<aiTypes.AnyModel["inputLimits"]>;
    cost: aiTypes.AnyModel["cost"];
    headers?: Record<string, string>;
  }

  interface ProviderChatModelConfig extends ProviderModelConfigBase {
    type?: "chat";
    api?: aiTypes.Api;
    reasoning: boolean;
    thinkingLevelMap?: NonNullable<aiTypes.Model<aiTypes.Api>["thinkingLevelMap"]>;
    promptCache?: NonNullable<aiTypes.Model<aiTypes.Api>["promptCache"]>;
    contextWindow: number;
    maxTokens: number;
    samplingParams?: NonNullable<aiTypes.Model<aiTypes.Api>["samplingParams"]>;
    samplingParamsByThinkingLevel?: NonNullable<
      aiTypes.Model<aiTypes.Api>["samplingParamsByThinkingLevel"]
    >;
    compat?: aiTypes.Model<aiTypes.Api>["compat"];
  }

  interface ProviderImageModelConfig extends ProviderModelConfigBase {
    type: "image";
    api?: aiTypes.ImageApi;
    output: ("text" | "image")[];
  }

  interface ProviderClassifierModelConfig extends ProviderModelConfigBase {
    type: "classifier";
    api?: aiTypes.ClassifierApi;
    contextWindow: number;
  }

  type ProviderModelConfig =
    | ProviderChatModelConfig
    | ProviderImageModelConfig
    | ProviderClassifierModelConfig;

  interface ProviderConfigInput {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    api?: aiTypes.Api;
    streamSimple?: (
      model: aiTypes.Model<aiTypes.Api>,
      context: aiTypes.TranscriptContext,
      options?: aiTypes.SimpleStreamOptions,
    ) => aiTypes.AssistantMessageEventStream;
    images?: Partial<Record<aiTypes.ImageApi, aiTypes.ProviderImages>>;
    classifiers?: Partial<Record<aiTypes.ClassifierApi, aiTypes.ProviderClassifier>>;
    headers?: Record<string, string>;
    authHeader?: boolean;
    oauth?: ExtensionOAuthConfig;
    models?: ProviderModelConfig[];
    refreshModels?(context: aiTypes.RefreshModelsContext): Promise<ProviderModelConfig[]>;
  }

  type AuthStatus = {
    configured: boolean;
    source?:
      | "stored"
      | "runtime"
      | "environment"
      | "fallback"
      | "models_json_key"
      | "models_json_command";
    label?: string | undefined;
  };

  interface CompatibilityRequestConfig {
    headers?: aiTypes.ProviderHeaders | undefined;
    authHeader: boolean;
  }
}

export type { providerComposerTypes as default };
