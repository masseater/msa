import type typesModule from "../types.types.ts";
import lazy from "./lazy.ts";

const { lazyApi } = lazy;

const openAIResponsesApi = (): typesModule.ProviderStreams =>
  lazyApi(() => import("./openai-responses.ts").then((module) => module.default));

const openaiResponsesLazy = {
  openAIResponsesApi,
};

export default openaiResponsesLazy;
