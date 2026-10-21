import type typesModule from "../types.types.ts";
import lazy from "./lazy.ts";

const { lazyApi } = lazy;

const openAICompletionsApi = (): typesModule.ProviderStreams =>
  lazyApi(() => import("./openai-completions.ts").then((module) => module.default));

const openaiCompletionsLazy = {
  openAICompletionsApi,
};

export default openaiCompletionsLazy;
