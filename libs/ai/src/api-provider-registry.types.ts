import type typesModule from "./types.types.ts";

declare namespace apiProviderRegistryTypes {
  interface ApiProviderInternal {
    api: typesModule.Api;
    stream: ApiStreamFunction;
    streamSimple: ApiStreamSimpleFunction;
  }

  type ApiStreamFunction = (
    model: typesModule.Model<typesModule.Api>,
    context: typesModule.TranscriptContext,
    options?: typesModule.StreamOptions,
  ) => typesModule.AssistantMessageEventStream;

  type ApiStreamSimpleFunction = (
    model: typesModule.Model<typesModule.Api>,
    context: typesModule.TranscriptContext,
    options?: typesModule.SimpleStreamOptions,
  ) => typesModule.AssistantMessageEventStream;

  interface ApiProvider<
    TApi extends typesModule.Api = typesModule.Api,
    TOptions extends typesModule.StreamOptions = typesModule.StreamOptions,
  > {
    api: TApi;
    stream: typesModule.StreamFunction<TApi, TOptions>;
    streamSimple: typesModule.StreamFunction<TApi, typesModule.SimpleStreamOptions>;
  }
}

export type { apiProviderRegistryTypes as default };
