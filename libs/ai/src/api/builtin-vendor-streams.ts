import type typesModule from "../types.types.ts";
import anthropicMessagesLazy from "./anthropic-messages.lazy.ts";
import googleGenerativeAiLazy from "./google-generative-ai.lazy.ts";

const { anthropicMessagesApi } = anthropicMessagesLazy;
const { googleGenerativeAIApi } = googleGenerativeAiLazy;

function builtinVendorStreams(): [typesModule.Api, typesModule.ProviderStreams][] {
  return [
    ["anthropic-messages", anthropicMessagesApi()],
    ["google-generative-ai", googleGenerativeAIApi()],
  ];
}

const builtinVendorStreamsModule = {
  builtinVendorStreams,
};

export default builtinVendorStreamsModule;
