import type { KnownProvider, ProviderEnv } from "./types.ts";
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
  // ANTHROPIC_AUTH_TOKEN participates in env discovery/status, but
  // getEnvApiKey() skips it because requests must pass it as Authorization: Bearer.
  if (provider === "anthropic") {
    return [ANTHROPIC_AUTH_TOKEN_ENV, ANTHROPIC_OAUTH_TOKEN_ENV, ANTHROPIC_API_KEY_ENV];
  }

  const envMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    radius: "RADIUS_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    opencode: "OPENCODE_API_KEY",
    "opencode-go": "OPENCODE_API_KEY",
  };

  const envVar = envMap[provider];
  return envVar ? [envVar] : undefined;
}

/**
 * Find configured environment variables that can provide an API key for a provider.
 *
 * This only reports actual API key variables. It intentionally excludes ambient
 * credential sources such as AWS profiles and AWS IAM credentials.
 */
export function findEnvKeys(provider: KnownProvider, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined {
  const envVars = getApiKeyEnvVars(provider);
  if (!envVars) return undefined;

  const found = envVars.filter((envVar) => !!getProviderEnvValue(envVar, env));
  return found.length > 0 ? found : undefined;
}

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined {
  const envKeys = findEnvKeys(provider, env);
  if (envKeys?.[0]) {
    const apiKeyEnv =
      provider === "anthropic"
        ? envKeys.find((key) => key !== ANTHROPIC_AUTH_TOKEN_ENV)
        : envKeys[0];
    if (apiKeyEnv) return getProviderEnvValue(apiKeyEnv, env);
  }

  if (provider === "amazon-bedrock") {
    // Amazon Bedrock supports multiple credential sources:
    // 1. AWS_PROFILE - named profile from ~/.aws/credentials
    // 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY - standard IAM keys
    // 3. AWS_BEARER_TOKEN_BEDROCK - Bedrock bearer token
    // 4. AWS_CONTAINER_CREDENTIALS_RELATIVE_URI - ECS task roles
    // 5. AWS_CONTAINER_CREDENTIALS_FULL_URI - ECS task roles (full URI)
    // 6. AWS_WEB_IDENTITY_TOKEN_FILE - IRSA (IAM Roles for Service Accounts)
    if (
      getProviderEnvValue("AWS_PROFILE", env) ||
      (getProviderEnvValue("AWS_ACCESS_KEY_ID", env) &&
        getProviderEnvValue("AWS_SECRET_ACCESS_KEY", env)) ||
      getProviderEnvValue("AWS_BEARER_TOKEN_BEDROCK", env) ||
      getProviderEnvValue("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", env) ||
      getProviderEnvValue("AWS_CONTAINER_CREDENTIALS_FULL_URI", env) ||
      getProviderEnvValue("AWS_WEB_IDENTITY_TOKEN_FILE", env)
    ) {
      return "<authenticated>";
    }
  }

  return undefined;
}
