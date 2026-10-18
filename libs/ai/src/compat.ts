import { Function } from "effect";
export * from "./api/anthropic-messages.lazy.ts";
export * from "./api/google-generative-ai.lazy.ts";
export * from "./api/openai-codex-responses.lazy.ts";
export * from "./api/openai-completions.lazy.ts";
export * from "./api/openai-responses.lazy.ts";
export {
  type ApiProvider,
  type ApiStreamFunction,
  type ApiStreamSimpleFunction,
  getApiProvider,
  getApiProviders,
  registerApiProvider,
  registerFauxProvider,
  unregisterApiProviders,
} from "./api-provider-registry.ts";
export { registerBuiltInApiProviders, resetApiProviders } from "./builtin-api-providers.ts";
export * from "./env-api-keys.ts";
export * from "./image-models.ts";
export * from "./images.ts";
export * from "./images-api-registry.ts";
export * from "./index.ts";
export * from "./legacy-api-aliases.ts";
export * from "./legacy-openai-api-aliases.ts";
export * from "./providers/images/register-builtins.ts";

import { getApiProvider } from "./api-provider-registry.ts";
import { isBuiltinApiProvider, registerBuiltInApiProviders } from "./builtin-api-providers.ts";
import { getEnvApiKey } from "./env-api-keys.ts";
import {
  builtinModels,
  getBuiltinModel,
  getBuiltinModels,
  getBuiltinProviders,
} from "./providers/all.ts";

export type { BuiltinProvider } from "./providers/all.ts";

import type {
  Api,
  ApiStreamOptions,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  ProviderStreamOptions,
  SimpleStreamOptions,
  StreamOptions,
} from "./types.ts";
import { normalizeContext } from "./utils/transcript.ts";

export const getModel = getBuiltinModel;

export const getModels = getBuiltinModels;

export const getProviders = getBuiltinProviders;

registerBuiltInApiProviders();

const compatModels = builtinModels();
const AMBIENT_AUTH_MARKER = "<authenticated>";

function hasExplicitApiKey(apiKey: string | undefined): apiKey is string {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

function withEnvApiKey<TOptions extends StreamOptions>(
  model: Model<Api>,
  options: TOptions | undefined,
): TOptions | undefined {
  if (hasExplicitApiKey(options?.apiKey)) return options;
  const apiKey = getEnvApiKey(model.provider, options?.env);
  if (apiKey === undefined || apiKey === "" || apiKey === AMBIENT_AUTH_MARKER) return options;
  return { ...options, apiKey } as TOptions;
}

function getBuiltinProviderForModel(model: Model<Api>) {
  if (!isBuiltinApiProvider(model.api)) return undefined;
  const provider = compatModels.getProvider(model.provider);
  return provider?.getModels().some((candidate) => candidate.api === model.api) === true
    ? provider
    : undefined;
}

function resolveApiProvider(api: Api) {
  const provider = getApiProvider(api);
  if (provider === undefined) {
    throw new Error(`No API provider registered for api: ${api}`);
  }
  return provider;
}

export const stream: {
  <TApi extends Api>(
    context: Context,
    options?: ProviderStreamOptions,
  ): (model: Model<TApi>) => AssistantMessageEventStream;
  <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions,
  ): AssistantMessageEventStream;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions,
  ): AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    const builtinProvider = getBuiltinProviderForModel(model);
    if (builtinProvider !== undefined) {
      return builtinProvider.stream(
        model,
        transcript,
        withEnvApiKey(model, options) as ApiStreamOptions<TApi>,
      );
    }
    const provider = resolveApiProvider(model.api);
    return provider.stream(model, transcript, withEnvApiKey(model, options) as StreamOptions);
  },
);

export const complete: {
  <TApi extends Api>(
    context: Context,
    options?: ProviderStreamOptions,
  ): (model: Model<TApi>) => Promise<AssistantMessage>;
  <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions,
  ): Promise<AssistantMessage>;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ProviderStreamOptions,
  ): Promise<AssistantMessage> {
    try {
      return stream(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

export const streamSimple: {
  <TApi extends Api>(
    context: Context,
    options?: SimpleStreamOptions,
  ): (model: Model<TApi>) => AssistantMessageEventStream;
  <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    const builtinProvider = getBuiltinProviderForModel(model);
    if (builtinProvider !== undefined) {
      return builtinProvider.streamSimple(model, transcript, withEnvApiKey(model, options));
    }
    const provider = resolveApiProvider(model.api);
    return provider.streamSimple(model, transcript, withEnvApiKey(model, options));
  },
);

export const completeSimple: {
  <TApi extends Api>(
    context: Context,
    options?: SimpleStreamOptions,
  ): (model: Model<TApi>) => Promise<AssistantMessage>;
  <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessage>;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessage> {
    try {
      return streamSimple(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  },
);
