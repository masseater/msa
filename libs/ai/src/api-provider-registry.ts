import { Function } from "effect";

import type apiProviderRegistryTypes from "./api-provider-registry.types.ts";
import faux from "./providers/faux.ts";
import type fauxTypes from "./providers/faux.types.ts";
import type typesModule from "./types.types.ts";
import random from "./utils/random.ts";

const { createFauxCore } = faux;
const { nextRandom } = random;
type RegisteredApiProvider = {
  provider: apiProviderRegistryTypes.ApiProviderInternal;
  sourceId?: string | undefined;
};

const apiProviderRegistry = new Map<string, RegisteredApiProvider>();

function wrapStream<TApi extends typesModule.Api, TOptions extends typesModule.StreamOptions>(
  api: TApi,
  streamFn: typesModule.StreamFunction<TApi, TOptions>,
): apiProviderRegistryTypes.ApiStreamFunction {
  return (model, context, options) => {
    if (model.api !== api) {
      throw new Error(`Mismatched api: ${model.api} expected ${api}`);
    }
    return streamFn(model as typesModule.Model<TApi>, context, options as TOptions);
  };
}

function wrapStreamSimple<TApi extends typesModule.Api>(
  api: TApi,
  streamSimpleFn: typesModule.StreamFunction<TApi, typesModule.SimpleStreamOptions>,
): apiProviderRegistryTypes.ApiStreamSimpleFunction {
  return (model, context, options) => {
    if (model.api !== api) {
      throw new Error(`Mismatched api: ${model.api} expected ${api}`);
    }
    return streamSimpleFn(model as typesModule.Model<TApi>, context, options);
  };
}

const registerApiProvider: {
  <TApi extends typesModule.Api, TOptions extends typesModule.StreamOptions>(
    sourceId?: string,
  ): (provider: apiProviderRegistryTypes.ApiProvider<TApi, TOptions>) => void;
  <TApi extends typesModule.Api, TOptions extends typesModule.StreamOptions>(
    provider: apiProviderRegistryTypes.ApiProvider<TApi, TOptions>,
    sourceId?: string,
  ): void;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null,
  function <TApi extends typesModule.Api, TOptions extends typesModule.StreamOptions>(
    provider: apiProviderRegistryTypes.ApiProvider<TApi, TOptions>,
    sourceId?: string,
  ): void {
    apiProviderRegistry.set(provider.api, {
      provider: {
        api: provider.api,
        stream: wrapStream(provider.api, provider.stream),
        streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
      },
      sourceId,
    });
  },
);

function getApiProvider(
  api: typesModule.Api,
): apiProviderRegistryTypes.ApiProviderInternal | undefined {
  return apiProviderRegistry.get(api)?.provider;
}

function getApiProviders(): apiProviderRegistryTypes.ApiProviderInternal[] {
  return Array.from(apiProviderRegistry.values(), (entry) => entry.provider);
}

function unregisterApiProviders(sourceId: string): void {
  for (const [api, entry] of apiProviderRegistry.entries()) {
    if (entry.sourceId === sourceId) {
      apiProviderRegistry.delete(api);
    }
  }
}

function clearApiProviders(): void {
  apiProviderRegistry.clear();
}

function registerFauxProvider(
  options: fauxTypes.RegisterFauxProviderOptions = {},
): fauxTypes.FauxProviderRegistration {
  const core = createFauxCore(options);
  const sourceId = `faux-provider-${nextRandom().toString(36).slice(2, 10)}`;
  registerApiProvider(
    { api: core.api, stream: core.stream, streamSimple: core.streamSimple },
    sourceId,
  );
  return {
    api: core.api,
    appendResponses: core.appendResponses,
    getModel: core.getModel,
    getPendingResponseCount: core.getPendingResponseCount,
    models: core.models,
    setResponses: core.setResponses,
    state: core.state,
    unregister() {
      unregisterApiProviders(sourceId);
    },
  };
}

const apiProviderRegistryModule = {
  clearApiProviders,
  getApiProvider,
  getApiProviders,
  registerApiProvider,
  registerFauxProvider,
  unregisterApiProviders,
};

export default apiProviderRegistryModule;
