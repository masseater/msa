import type typesModule from "../types.types.ts";
import lazy from "./lazy.ts";

const { lazyApi } = lazy;

const openAICodexResponsesApi = (): typesModule.ProviderStreams =>
  lazyApi(() => import("./openai-codex-responses.ts").then((module) => module.default));

const openaiCodexResponsesLazy = {
  openAICodexResponsesApi,
};

export default openaiCodexResponsesLazy;
