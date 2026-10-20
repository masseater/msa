import apiProviderRegistryModule from "./api-provider-registry.ts";
import builtinOpenaiStreams from "./api/builtin-openai-streams.ts";
import builtinVendorStreamsModule from "./api/builtin-vendor-streams.ts";
import type typesModule from "./types.types.ts";

const { builtinOpenAIStreams } = builtinOpenaiStreams;
const { builtinVendorStreams } = builtinVendorStreamsModule;
const { clearApiProviders, getApiProvider, registerApiProvider } = apiProviderRegistryModule;

const BUILTIN_APIS = [...builtinOpenAIStreams(), ...builtinVendorStreams()];

const builtinApiProviderInstances = new Map<typesModule.Api, ReturnType<typeof getApiProvider>>();

function isBuiltinApiProvider(api: typesModule.Api): boolean {
  return getApiProvider(api) === builtinApiProviderInstances.get(api);
}

function registerBuiltInApiProviders(): void {
  for (const [api, streams] of BUILTIN_APIS) {
    if (getApiProvider(api) === undefined) {
      registerApiProvider({ api, stream: streams.stream, streamSimple: streams.streamSimple });
    }
    builtinApiProviderInstances.set(api, getApiProvider(api));
  }
}

function resetApiProviders(): void {
  clearApiProviders();
  builtinApiProviderInstances.clear();
  registerBuiltInApiProviders();
}

const builtinApiProviders = {
  isBuiltinApiProvider,
  registerBuiltInApiProviders,
  resetApiProviders,
};

export default builtinApiProviders;
