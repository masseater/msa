import { Function } from "effect";

import {
  createFauxCore,
  type FauxProviderRegistration,
  type RegisterFauxProviderOptions,
} from "./providers/faux.ts";
import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  TranscriptContext,
} from "./types.ts";
import { nextRandom } from "./utils/random.ts";

export type ApiStreamFunction = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: StreamOptions,
) => AssistantMessageEventStream;

export type ApiStreamSimpleFunction = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface ApiProvider<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
> {
  api: TApi;
  stream: StreamFunction<TApi, TOptions>;
  streamSimple: StreamFunction<TApi, SimpleStreamOptions>;
}

interface ApiProviderInternal {
  api: Api;
  stream: ApiStreamFunction;
  streamSimple: ApiStreamSimpleFunction;
}

type RegisteredApiProvider = {
  provider: ApiProviderInternal;
  sourceId?: string | undefined;
};

const apiProviderRegistry = new Map<string, RegisteredApiProvider>();

function wrapStream<TApi extends Api, TOptions extends StreamOptions>(
  api: TApi,
  streamFn: StreamFunction<TApi, TOptions>,
): ApiStreamFunction {
  return (model, context, options) => {
    if (model.api !== api) {
      throw new Error(`Mismatched api: ${model.api} expected ${api}`);
    }
    return streamFn(model as Model<TApi>, context, options as TOptions);
  };
}

function wrapStreamSimple<TApi extends Api>(
  api: TApi,
  streamSimpleFn: StreamFunction<TApi, SimpleStreamOptions>,
): ApiStreamSimpleFunction {
  return (model, context, options) => {
    if (model.api !== api) {
      throw new Error(`Mismatched api: ${model.api} expected ${api}`);
    }
    return streamSimpleFn(model as Model<TApi>, context, options);
  };
}

export const registerApiProvider: {
  <TApi extends Api, TOptions extends StreamOptions>(
    sourceId?: string,
  ): (provider: ApiProvider<TApi, TOptions>) => void;
  <TApi extends Api, TOptions extends StreamOptions>(
    provider: ApiProvider<TApi, TOptions>,
    sourceId?: string,
  ): void;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null,
  function <TApi extends Api, TOptions extends StreamOptions>(
    provider: ApiProvider<TApi, TOptions>,
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

export function getApiProvider(api: Api): ApiProviderInternal | undefined {
  return apiProviderRegistry.get(api)?.provider;
}

export function getApiProviders(): ApiProviderInternal[] {
  return Array.from(apiProviderRegistry.values(), (entry) => entry.provider);
}

export function unregisterApiProviders(sourceId: string): void {
  for (const [api, entry] of apiProviderRegistry.entries()) {
    if (entry.sourceId === sourceId) {
      apiProviderRegistry.delete(api);
    }
  }
}

export function clearApiProviders(): void {
  apiProviderRegistry.clear();
}

export function registerFauxProvider(
  options: RegisterFauxProviderOptions = {},
): FauxProviderRegistration {
  const core = createFauxCore(options);
  const sourceId = `faux-provider-${nextRandom().toString(36).slice(2, 10)}`;
  registerApiProvider(
    { api: core.api, stream: core.stream, streamSimple: core.streamSimple },
    sourceId,
  );
  return {
    api: core.api,
    models: core.models,
    getModel: core.getModel,
    state: core.state,
    setResponses: core.setResponses,
    appendResponses: core.appendResponses,
    getPendingResponseCount: core.getPendingResponseCount,
    unregister() {
      unregisterApiProviders(sourceId);
    },
  };
}
