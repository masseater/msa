import type aiTypes from "@msa/ai/index.types";
import type tuiTypes from "@msa/tui/index.types";

import type { SourceInfo } from "../source-info.ts";
import type { ModelRoute, ModelRouteRequest, VirtualModelDefinition } from "../virtual-models.ts";
import type { ExtensionAPI } from "./types-api.ts";
import type { ExtensionContext } from "./types-context.ts";
import type { ToolDefinition } from "./types-tools.ts";

export interface ExtensionVirtualModel<TState = unknown> extends Omit<
  VirtualModelDefinition<TState>,
  "route"
> {
  route(
    request: ModelRouteRequest<TState>,
    ctx: ExtensionContext,
  ): ModelRoute<TState> | Promise<ModelRoute<TState>>;
}

export interface ProviderConfig {
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

export interface ProviderChatModelConfig extends ProviderModelConfigBase {
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

export interface ProviderImageModelConfig extends ProviderModelConfigBase {
  type: "image";
  api?: aiTypes.ImageApi;
  output: ("text" | "image")[];
}

export interface ProviderClassifierModelConfig extends ProviderModelConfigBase {
  type: "classifier";
  api?: aiTypes.ClassifierApi;
  contextWindow: number;
}

export type ProviderModelConfig =
  | ProviderChatModelConfig
  | ProviderImageModelConfig
  | ProviderClassifierModelConfig;

export type ExtensionFactory = (msa: ExtensionAPI) => void | Promise<void>;

export type InlineExtension =
  | ExtensionFactory
  | {
      name: string;
      factory: ExtensionFactory;
      hidden?: boolean;
      replaceable?: boolean;
      builtin?: boolean;
    };

export interface RegisteredTool {
  definition: ToolDefinition;
  sourceInfo: SourceInfo;
}

export interface ExtensionFlag {
  name: string;
  description?: string;
  type: "boolean" | "string";
  default?: boolean | string;
  extensionPath: string;
}

export interface ExtensionShortcut {
  shortcut: tuiTypes.KeyId;
  description?: string;
  handler: (ctx: ExtensionContext) => Promise<void> | void;
  extensionPath: string;
}
