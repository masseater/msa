import { clearApiProviders, getApiProvider, registerApiProvider } from "./api-provider-registry.ts";
import { builtinOpenAIStreams } from "./api/builtin-openai-streams.ts";
import { builtinVendorStreams } from "./api/builtin-vendor-streams.ts";
import type { Api } from "./types.ts";

const BUILTIN_APIS = [...builtinOpenAIStreams(), ...builtinVendorStreams()];

const builtinApiProviderInstances = new Map<Api, ReturnType<typeof getApiProvider>>();

export function isBuiltinApiProvider(api: Api): boolean {
  return getApiProvider(api) === builtinApiProviderInstances.get(api);
}

export function registerBuiltInApiProviders(): void {
  for (const [api, streams] of BUILTIN_APIS) {
    if (getApiProvider(api) === undefined) {
      registerApiProvider({ api, stream: streams.stream, streamSimple: streams.streamSimple });
    }
    builtinApiProviderInstances.set(api, getApiProvider(api));
  }
}

export function resetApiProviders(): void {
  clearApiProviders();
  builtinApiProviderInstances.clear();
  registerBuiltInApiProviders();
}
