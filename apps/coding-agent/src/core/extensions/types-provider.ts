import type {
  AnyModel,
  Api,
  AssistantMessageEventStream,
  ClassifierApi,
  ImageApi,
  Model,
  OAuthCredentials,
  OAuthLoginCallbacks,
  ProviderClassifier,
  ProviderImages,
  RefreshModelsContext,
  SimpleStreamOptions,
  TranscriptContext,
} from "@msa/ai";
import type { KeyId } from "@msa/tui";

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
  api?: Api;
  streamSimple?: (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
  images?: Partial<Record<ImageApi, ProviderImages>>;
  classifiers?: Partial<Record<ClassifierApi, ProviderClassifier>>;
  headers?: Record<string, string>;
  authHeader?: boolean;
  models?: ProviderModelConfig[];
  refreshModels?(context: RefreshModelsContext): Promise<ProviderModelConfig[]>;
  oauth?: {
    name: string;
    isSubscription?: boolean;
    usesCallbackServer?: boolean;
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
    refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials>;
    getApiKey(credentials: OAuthCredentials): string;
    modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[];
  };
}

interface ProviderModelConfigBase {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  input: ("text" | "image")[];
  inputLimits?: NonNullable<AnyModel["inputLimits"]>;
  cost: AnyModel["cost"];
  headers?: Record<string, string>;
}

export interface ProviderChatModelConfig extends ProviderModelConfigBase {
  type?: "chat";
  api?: Api;
  reasoning: boolean;
  thinkingLevelMap?: NonNullable<Model<Api>["thinkingLevelMap"]>;
  promptCache?: NonNullable<Model<Api>["promptCache"]>;
  contextWindow: number;
  maxTokens: number;
  samplingParams?: Record<string, unknown>;
  compat?: Model<Api>["compat"];
}

export interface ProviderImageModelConfig extends ProviderModelConfigBase {
  type: "image";
  api?: ImageApi;
  output: ("text" | "image")[];
}

export interface ProviderClassifierModelConfig extends ProviderModelConfigBase {
  type: "classifier";
  api?: ClassifierApi;
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
  shortcut: KeyId;
  description?: string;
  handler: (ctx: ExtensionContext) => Promise<void> | void;
  extensionPath: string;
}
