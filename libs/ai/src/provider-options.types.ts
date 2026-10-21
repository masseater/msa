import type telemetryTypes from "@msa/telemetry/index.types";

import type apiOptionsOpenaiTypes from "./api-options-openai.ts";
import type apiOptionsVendorTypes from "./api-options-vendor.ts";
import type modelTypesModule from "./model-types.ts";
import type modelSchemaTypes from "./providers/model-schema.types.ts";
import type typesModule from "./types.types.ts";

declare namespace providerOptionsTypes {
  type KnownApi =
    | "openai-completions"
    | "openai-responses"
    | "openai-codex-responses"
    | "anthropic-messages"
    | "google-generative-ai";
  type Api = typesModule.KnownApi | (string & {});
  type KnownImageApi = "openrouter-images";
  type ImageApi = typesModule.KnownImageApi | (string & {});
  type KnownClassifierApi = "typesafe-system-one" | "llama-cpp-classify" | "openai-decisions";
  type ClassifierApi = typesModule.KnownClassifierApi | (string & {});
  type KnownProvider =
    | "anthropic-api"
    | "openai"
    | "openai-codex"
    | "openrouter"
    | "opencode"
    | "opencode-go";
  type ProviderId = typesModule.KnownProvider | string;
  type ToolChoice = "auto" | "none";
  type SamplingParams = Record<string, unknown>;
  type SamplingParamsByThinkingLevel = Partial<
    Record<modelSchemaTypes.ModelThinkingLevel, typesModule.SamplingParams>
  >;
  interface ThinkingBudgets {
    minimal?: number;
    low?: number;
    medium?: number;
    high?: number;
  }
  type Transport = "sse" | "websocket" | "websocket-cached" | "auto";
  type ProviderEnv = Record<string, string>;
  type ProviderHeaders = Record<string, string | null>;
  type FetchFunction = typeof globalThis.fetch;
  interface ProviderResponse {
    status: number;
    headers: Record<string, string>;
  }
  interface ProviderRequestOptions<TModel = typesModule.Model<typesModule.Api>> {
    signal?: AbortSignal | undefined;
    telemetryContext?: telemetryTypes.TelemetryContext | undefined;
    apiKey?: string | undefined;
    fetch?: typesModule.FetchFunction | undefined;
    env?: typesModule.ProviderEnv | undefined;
    onPayload?:
      | ((payload: unknown, model: TModel) => unknown | undefined | Promise<unknown | undefined>)
      | undefined;
    onResponse?:
      | ((response: typesModule.ProviderResponse, model: TModel) => void | Promise<void>)
      | undefined;
    headers?: typesModule.ProviderHeaders | undefined;
    timeoutMs?: number | undefined;
    maxRetries?: number | undefined;
    maxRetryDelayMs?: number | undefined;
  }
  interface StreamOptions extends typesModule.ProviderRequestOptions<
    modelTypesModule.Model<typesModule.Api>
  > {
    onResponse?:
      | ((
          response: typesModule.ProviderResponse,
          model: modelTypesModule.Model<typesModule.Api>,
        ) => void | Promise<void>)
      | undefined;
    onProviderStreamEvent?:
      | ((data: unknown, model: modelTypesModule.Model<typesModule.Api>) => void | Promise<void>)
      | undefined;
    temperature?: number | undefined;
    samplingParams?: typesModule.SamplingParams | undefined;
    maxTokens?: number | undefined;
    transport?: typesModule.Transport | undefined;
    cacheRetention?: modelSchemaTypes.CacheRetention | undefined;
    sessionId?: string | undefined;
    websocketConnectTimeoutMs?: number | undefined;
    metadata?: Record<string, unknown> | undefined;
  }
  type ProviderStreamOptions = typesModule.StreamOptions & Record<string, unknown>;
  interface DeferredFetchOptions extends typesModule.ProviderRequestOptions<
    modelTypesModule.Model<typesModule.Api>
  > {
    wait?: number;
  }
  type DeferredCancelOptions = typesModule.ProviderRequestOptions<
    modelTypesModule.Model<typesModule.Api>
  >;
  interface SimpleStreamOptions extends typesModule.StreamOptions {
    toolChoice?: typesModule.ToolChoice | undefined;
    reasoning?: modelSchemaTypes.ThinkingLevel | undefined;
    deferred?: boolean | { window?: "15m" | "1h" | "24h" } | undefined;
    thinkingBudgets?: typesModule.ThinkingBudgets | undefined;
  }
  interface ApiOptionsMap
    extends apiOptionsOpenaiTypes.OpenAIApiOptionsMap, apiOptionsVendorTypes.VendorApiOptionsMap {}
  type ApiStreamOptions<TApi extends typesModule.Api> = TApi extends keyof typesModule.ApiOptionsMap
    ? typesModule.ApiOptionsMap[TApi]
    : typesModule.StreamOptions & Record<string, unknown>;
}

export type { providerOptionsTypes as default };
