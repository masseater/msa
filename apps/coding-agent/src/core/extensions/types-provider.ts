import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";

import type sourceInfoTypes from "../source-info.types.ts";
import type virtualModelsTypes from "../virtual-models.types.ts";
import type typesApiTypes from "./types-api.ts";
import type typesContextTypes from "./types-context.ts";
import type typesToolsTypes from "./types-tools.types.ts";

declare namespace typesProviderTypes {
  interface ExtensionVirtualModel<TState = unknown> extends Omit<
    virtualModelsTypes.VirtualModelDefinition<TState>,
    "route"
  > {
    route(
      request: virtualModelsTypes.ModelRouteRequest<TState>,
      ctx: typesContextTypes.ExtensionContext,
    ): virtualModelsTypes.ModelRoute<TState> | Promise<virtualModelsTypes.ModelRoute<TState>>;
  }

  interface ProviderConfig {
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
    models?: ProviderModelConfig[];
    refreshModels?(context: aiTypes.RefreshModelsContext): Promise<ProviderModelConfig[]>;
    oauth?: {
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
    };
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
    samplingParams?: Record<string, unknown>;
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

  type ExtensionFactory = (msa: typesApiTypes.ExtensionAPI) => void | Promise<void>;

  type InlineExtension =
    | ExtensionFactory
    | {
        name: string;
        factory: ExtensionFactory;
        hidden?: boolean;
        replaceable?: boolean;
        builtin?: boolean;
      };

  interface RegisteredTool {
    definition: typesToolsTypes.ToolDefinition;
    sourceInfo: sourceInfoTypes.SourceInfo;
  }

  interface ExtensionFlag {
    name: string;
    description?: string;
    type: "boolean" | "string";
    default?: boolean | string;
    extensionPath: string;
  }

  interface ExtensionShortcut {
    shortcut: tuiTypes.KeyId;
    description?: string;
    handler: (ctx: typesContextTypes.ExtensionContext) => Promise<void> | void;
    extensionPath: string;
  }
}

export type { typesProviderTypes as default };
