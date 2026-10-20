import load from "./auth/oauth/load.ts";
import openaiChatgpt from "./auth/oauth/openai-chatgpt.ts";
import openaiCodexModule from "./auth/oauth/openai-codex.ts";
import openrouterModule from "./auth/oauth/openrouter.ts";

const { registerBundledOAuthFlowLoaders } = load;
const { openaiChatGPTOAuth } = openaiChatgpt;
const { openaiCodexOAuth } = openaiCodexModule;
const { openRouterOAuth } = openrouterModule;

function registerBunOAuthFlows(): void {
  registerBundledOAuthFlowLoaders({
    openaiChatGPT: () => openaiChatGPTOAuth,
    openaiCodex: () => openaiCodexOAuth,
    openrouter: () => openRouterOAuth,
  });
}

const bunOauth = {
  registerBunOAuthFlows,
};

export default bunOauth;
