import { Function } from "effect";

import compatKit from "./compat-kit.ts";
import type typesModule from "./types.types.ts";
import transcriptModule from "./utils/transcript.ts";

const {
  all,
  apiProviderRegistry: apiProviderRegistryModule,
  builtinApiProviders,
  envApiKeys,
} = compatKit;
const { builtinModels, getBuiltinModel, getBuiltinModels, getBuiltinProviders } = all;
const { isBuiltinApiProvider } = builtinApiProviders;
const { getEnvApiKey } = envApiKeys;
const { getApiProvider } = apiProviderRegistryModule;
const { normalizeContext } = transcriptModule;

const getModel = getBuiltinModel;

const getModels = getBuiltinModels;

const getProviders = getBuiltinProviders;

const compatModels = builtinModels();

const AMBIENT_AUTH_MARKER = "<authenticated>";

function hasExplicitApiKey(apiKey: string | undefined): apiKey is string {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

function withEnvApiKey<TOptions extends typesModule.StreamOptions>(
  model: typesModule.Model<typesModule.Api>,
  options: TOptions | undefined,
): TOptions | undefined {
  if (hasExplicitApiKey(options?.apiKey)) return options;
  const apiKey = getEnvApiKey(model.provider, options?.env);
  if (apiKey === undefined || apiKey === "" || apiKey === AMBIENT_AUTH_MARKER) return options;
  return { ...options, apiKey } as TOptions;
}

function getBuiltinProviderForModel(model: typesModule.Model<typesModule.Api>) {
  if (!isBuiltinApiProvider(model.api)) return undefined;
  const provider = compatModels.getProvider(model.provider);
  return provider?.getModels().some((candidate) => candidate.api === model.api) === true
    ? provider
    : undefined;
}

function resolveApiProvider(api: typesModule.Api) {
  const provider = getApiProvider(api);
  if (provider === undefined) {
    throw new Error(`No API provider registered for api: ${api}`);
  }
  return provider;
}

const stream: {
  <TApi extends typesModule.Api>(
    context: typesModule.Context,
    options?: typesModule.ProviderStreamOptions,
  ): (model: typesModule.Model<TApi>) => typesModule.AssistantMessageEventStream;
  <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.Context,
    options?: typesModule.ProviderStreamOptions,
  ): typesModule.AssistantMessageEventStream;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.Context,
    options?: typesModule.ProviderStreamOptions,
  ): typesModule.AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    const builtinProvider = getBuiltinProviderForModel(model);
    if (builtinProvider !== undefined) {
      return builtinProvider.stream(
        model,
        transcript,
        withEnvApiKey(model, options) as typesModule.ApiStreamOptions<TApi>,
      );
    }
    const provider = resolveApiProvider(model.api);
    return provider.stream(
      model,
      transcript,
      withEnvApiKey(model, options) as typesModule.StreamOptions,
    );
  },
);

const complete: {
  <TApi extends typesModule.Api>(
    context: typesModule.Context,
    options?: typesModule.ProviderStreamOptions,
  ): (model: typesModule.Model<TApi>) => Promise<typesModule.AssistantMessage>;
  <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.Context,
    options?: typesModule.ProviderStreamOptions,
  ): Promise<typesModule.AssistantMessage>;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.Context,
    options?: typesModule.ProviderStreamOptions,
  ): Promise<typesModule.AssistantMessage> {
    try {
      return stream(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

const streamSimple: {
  <TApi extends typesModule.Api>(
    context: typesModule.Context,
    options?: typesModule.SimpleStreamOptions,
  ): (model: typesModule.Model<TApi>) => typesModule.AssistantMessageEventStream;
  <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.Context,
    options?: typesModule.SimpleStreamOptions,
  ): typesModule.AssistantMessageEventStream;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.Context,
    options?: typesModule.SimpleStreamOptions,
  ): typesModule.AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    const builtinProvider = getBuiltinProviderForModel(model);
    if (builtinProvider !== undefined) {
      return builtinProvider.streamSimple(model, transcript, withEnvApiKey(model, options));
    }
    const provider = resolveApiProvider(model.api);
    return provider.streamSimple(model, transcript, withEnvApiKey(model, options));
  },
);

const completeSimple: {
  <TApi extends typesModule.Api>(
    context: typesModule.Context,
    options?: typesModule.SimpleStreamOptions,
  ): (model: typesModule.Model<TApi>) => Promise<typesModule.AssistantMessage>;
  <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.Context,
    options?: typesModule.SimpleStreamOptions,
  ): Promise<typesModule.AssistantMessage>;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "api" in args[0],
  function <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    context: typesModule.Context,
    options?: typesModule.SimpleStreamOptions,
  ): Promise<typesModule.AssistantMessage> {
    try {
      return streamSimple(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

const compatStream = {
  AMBIENT_AUTH_MARKER,
  compatModels,
  complete,
  completeSimple,
  getBuiltinProviderForModel,
  getModel,
  getModels,
  getProviders,
  hasExplicitApiKey,
  resolveApiProvider,
  stream,
  streamSimple,
  withEnvApiKey,
};

export default compatStream;
