import type typesModule from "../types.ts";

const loadOpenAICodexOAuth = (): Promise<typesModule.OAuthAuth> =>
  import("./openai-codex.ts").then((module) => module.default.openaiCodexOAuth);

const loadOpenAIChatGPTOAuth = (): Promise<typesModule.OAuthAuth> =>
  import("./openai-chatgpt.ts").then((module) => module.default.openaiChatGPTOAuth);

const loadOpenRouterOAuth = (): Promise<typesModule.OAuthAuth> =>
  import("./openrouter.ts").then((module) => module.default.openRouterOAuth);

const load = {
  loadOpenAIChatGPTOAuth,
  loadOpenAICodexOAuth,
  loadOpenRouterOAuth,
};

export default load;
