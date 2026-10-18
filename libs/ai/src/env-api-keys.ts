import { Function } from "effect";

import type { ProviderEnv } from "./types.ts";
import { getProviderEnvValue } from "./utils/provider-env.ts";

export const ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
export const ANTHROPIC_OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN";
export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
export const ANTHROPIC_FEDERATION_RULE_ID_ENV = "ANTHROPIC_FEDERATION_RULE_ID";
export const ANTHROPIC_ORGANIZATION_ID_ENV = "ANTHROPIC_ORGANIZATION_ID";
export const ANTHROPIC_SERVICE_ACCOUNT_ID_ENV = "ANTHROPIC_SERVICE_ACCOUNT_ID";
export const ANTHROPIC_IDENTITY_TOKEN_FILE_ENV = "ANTHROPIC_IDENTITY_TOKEN_FILE";
export const ANTHROPIC_WORKSPACE_ID_ENV = "ANTHROPIC_WORKSPACE_ID";

function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
  if (provider === "anthropic") {
    return [ANTHROPIC_AUTH_TOKEN_ENV, ANTHROPIC_OAUTH_TOKEN_ENV, ANTHROPIC_API_KEY_ENV];
  }

  const envMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    opencode: "OPENCODE_API_KEY",
    "opencode-go": "OPENCODE_API_KEY",
  };

  const envVar = envMap[provider];
  return envVar !== undefined && envVar !== "" ? [envVar] : undefined;
}

const hasEnvValue = (name: string, env: ProviderEnv | undefined): boolean => {
  const value = getProviderEnvValue(name, env);
  return value !== undefined && value !== "";
};

const findKeys = (provider: string, env?: ProviderEnv): string[] | undefined => {
  const envVars = getApiKeyEnvVars(provider);
  if (envVars === undefined) return undefined;

  const found = envVars.filter((envVar) => hasEnvValue(envVar, env));
  return found.length > 0 ? found : undefined;
};

const isProviderFirst = (args: IArguments): boolean => typeof args[0] === "string";

export const findEnvKeys: {
  (env?: ProviderEnv): (provider: string) => string[] | undefined;
  (provider: string, env?: ProviderEnv): string[] | undefined;
} = Function.dual(isProviderFirst, findKeys);

const getKey = (provider: string, env?: ProviderEnv): string | undefined => {
  const envKeys = findKeys(provider, env);
  if (envKeys?.[0] !== undefined && envKeys[0] !== "") {
    const apiKeyEnv =
      provider === "anthropic"
        ? envKeys.find((key) => key !== ANTHROPIC_AUTH_TOKEN_ENV)
        : envKeys[0];
    if (apiKeyEnv !== undefined && apiKeyEnv !== "") return getProviderEnvValue(apiKeyEnv, env);
  }
  return undefined;
};

export const getEnvApiKey: {
  (env?: ProviderEnv): (provider: string) => string | undefined;
  (provider: string, env?: ProviderEnv): string | undefined;
} = Function.dual(isProviderFirst, getKey);
