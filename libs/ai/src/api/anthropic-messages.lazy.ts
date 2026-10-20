import type typesModule from "../types.types.ts";
import lazy from "./lazy.ts";

const { lazyApi } = lazy;

const anthropicMessagesApi = (): typesModule.ProviderStreams =>
  lazyApi(() => import("./anthropic-messages.ts").then((module) => module.default), {
    countTokens: true,
  });

const anthropicMessagesLazy = {
  anthropicMessagesApi,
};

export default anthropicMessagesLazy;
