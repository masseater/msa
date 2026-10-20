import config from "../config.ts";
import platformNode from "./platform-node.ts";

const { join } = platformNode;
const { getDocsPath } = config;

const UNKNOWN_PROVIDER = "unknown";

function getProviderLoginHelp(): string {
  return [
    "Use /login to log into a provider via OAuth or API key. See:",
    `  ${join(getDocsPath(), "providers.md")}`,
    `  ${join(getDocsPath(), "models.md")}`,
  ].join("\n");
}

function formatNoModelsAvailableMessage(): string {
  return `No models available. ${getProviderLoginHelp()}`;
}

function formatNoModelSelectedMessage(): string {
  return `No model selected.\n\n${getProviderLoginHelp()}\n\nThen use /model to select a model.`;
}

function formatNoApiKeyFoundMessage(provider: string): string {
  const providerDisplay = provider === UNKNOWN_PROVIDER ? "the selected model" : provider;
  return `No API key found for ${providerDisplay}.\n\n${getProviderLoginHelp()}`;
}

const authGuidance = {
  formatNoApiKeyFoundMessage,
  formatNoModelSelectedMessage,
  formatNoModelsAvailableMessage,
  getProviderLoginHelp,
};

export default authGuidance;
