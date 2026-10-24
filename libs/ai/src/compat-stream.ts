import { Effect, Function } from "effect";

import lazy from "./api/lazy.ts";
import type resolveTypes from "./auth/resolve.types.ts";
import type authTypes from "./auth/types.ts";
import compatKit from "./compat-kit.ts";
import modelsAuthApply from "./models-auth-apply.ts";
import type modelsTypes from "./models.types.ts";
import type typesModule from "./types.types.ts";
import transcriptModule from "./utils/transcript.ts";

const { all, apiProviderRegistry: apiProviderRegistryModule, builtinApiProviders } = compatKit;
const { builtinModels, getBuiltinModel, getBuiltinModels, getBuiltinProviders } = all;
const { isBuiltinApiProvider } = builtinApiProviders;
const { lazyStream } = lazy;
const { getApiProvider } = apiProviderRegistryModule;
const { authorize } = modelsAuthApply;
const { normalizeContext } = transcriptModule;

const getModel = getBuiltinModel;

const getModels = getBuiltinModels;

const getProviders = getBuiltinProviders;

const compatModels = builtinModels();

const resolveAuth = (
  providerOrModel: string | typesModule.AnyModel,
  overrides?: resolveTypes.AuthResolutionOverrides,
): Promise<authTypes.AuthResult | undefined> =>
  typeof providerOrModel === "string"
    ? compatModels.getAuth(providerOrModel, overrides)
    : compatModels.getAuth(providerOrModel, overrides);

function streamWithAuth<TApi extends typesModule.Api, TOptions extends typesModule.StreamOptions>(
  model: typesModule.Model<TApi>,
  options: TOptions | undefined,
  start: (
    model: typesModule.Model<TApi>,
    options: TOptions | undefined,
  ) => typesModule.AssistantMessageEventStream,
): typesModule.AssistantMessageEventStream {
  if (compatModels.getProvider(model.provider) === undefined) return start(model, options);
  return lazyStream(model, () =>
    Effect.runPromise(
      authorize({
        model,
        options,
        resolve: (overrides) => Effect.promise(() => resolveAuth(model, overrides)),
      }),
    ).then(({ requestModel, requestOptions }) => start(requestModel, requestOptions as TOptions)),
  );
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
    if (getBuiltinProviderForModel(model) !== undefined) {
      return compatModels.stream(
        model,
        context,
        options as modelsTypes.ModelsApiStreamOptions<TApi>,
      );
    }
    const provider = resolveApiProvider(model.api);
    const transcript = normalizeContext(context);
    return streamWithAuth(model, options, (target, resolved) =>
      provider.stream(target, transcript, resolved as typesModule.StreamOptions),
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
    if (getBuiltinProviderForModel(model) !== undefined) {
      return compatModels.streamSimple(model, context, options);
    }
    const provider = resolveApiProvider(model.api);
    const transcript = normalizeContext(context);
    return streamWithAuth(model, options, (target, resolved) =>
      provider.streamSimple(target, transcript, resolved),
    );
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
  compatModels,
  complete,
  completeSimple,
  getBuiltinProviderForModel,
  getModel,
  getModels,
  getProviders,
  resolveApiProvider,
  resolveAuth,
  stream,
  streamSimple,
};

export default compatStream;
