import { Function } from "effect";

import type { ProviderEnv } from "./types.ts";
import { getProviderEnvValue } from "./utils/provider-env.ts";
import { isNodeRuntime } from "./utils/runtime.ts";

let nodeExistsSync: typeof import("node:fs").existsSync | null = null;
let nodeHomedir: typeof import("node:os").homedir | null = null;
let nodeJoin: typeof import("node:path").join | null = null;

type DynamicImport = (specifier: string) => Promise<unknown>;

const dynamicImport: DynamicImport = (specifier) => import(specifier);

if (isNodeRuntime()) {
  void dynamicImport("node:fs").then((m) => {
    nodeExistsSync = (m as typeof import("node:fs")).existsSync;
    return nodeExistsSync;
  });
  void dynamicImport("node:os").then((m) => {
    nodeHomedir = (m as typeof import("node:os")).homedir;
    return nodeHomedir;
  });
  void dynamicImport("node:path").then((m) => {
    nodeJoin = (m as typeof import("node:path")).join;
    return nodeJoin;
  });
}

export const ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
export const ANTHROPIC_OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN";
export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
export const ANTHROPIC_FEDERATION_RULE_ID_ENV = "ANTHROPIC_FEDERATION_RULE_ID";
export const ANTHROPIC_ORGANIZATION_ID_ENV = "ANTHROPIC_ORGANIZATION_ID";
export const ANTHROPIC_SERVICE_ACCOUNT_ID_ENV = "ANTHROPIC_SERVICE_ACCOUNT_ID";
export const ANTHROPIC_IDENTITY_TOKEN_FILE_ENV = "ANTHROPIC_IDENTITY_TOKEN_FILE";
export const ANTHROPIC_WORKSPACE_ID_ENV = "ANTHROPIC_WORKSPACE_ID";

let cachedVertexAdcCredentialsExists: boolean | null = null;

function hasVertexAdcCredentials(env?: ProviderEnv): boolean {
  const explicitCredentialsPath = env?.["GOOGLE_APPLICATION_CREDENTIALS"];
  if (explicitCredentialsPath !== undefined && explicitCredentialsPath !== "") {
    return nodeExistsSync === null ? false : nodeExistsSync(explicitCredentialsPath);
  }

  if (cachedVertexAdcCredentialsExists === null) {
    if (nodeExistsSync === null || nodeHomedir === null || nodeJoin === null) {
      if (!isNodeRuntime()) cachedVertexAdcCredentialsExists = false;
      return false;
    }

    const gacPath = getProviderEnvValue("GOOGLE_APPLICATION_CREDENTIALS", env);
    if (gacPath !== undefined && gacPath !== "") {
      cachedVertexAdcCredentialsExists = nodeExistsSync(gacPath);
    } else {
      cachedVertexAdcCredentialsExists = nodeExistsSync(
        nodeJoin(nodeHomedir(), ".config", "gcloud", "application_default_credentials.json"),
      );
    }
  }
  return cachedVertexAdcCredentialsExists;
}

function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
  if (provider === "anthropic") {
    return [ANTHROPIC_AUTH_TOKEN_ENV, ANTHROPIC_OAUTH_TOKEN_ENV, ANTHROPIC_API_KEY_ENV];
  }

  const envMap: Record<string, string> = {
    "ant-ling": "ANT_LING_API_KEY",
    "qwen-token-plan": "QWEN_TOKEN_PLAN_API_KEY",
    "qwen-token-plan-cn": "QWEN_TOKEN_PLAN_CN_API_KEY",
    "qwen-token-plan-individual": "QWEN_TOKEN_PLAN_API_KEY",
    openai: "OPENAI_API_KEY",
    azure: "AZURE_OPENAI_API_KEY",
    nvidia: "NVIDIA_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    google: "GEMINI_API_KEY",
    "google-vertex": "GOOGLE_CLOUD_API_KEY",
    groq: "GROQ_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    xai: "XAI_API_KEY",
    typesafe: "TYPESAFE_API_KEY",
    radius: "RADIUS_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
    zai: "ZAI_API_KEY",
    "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
    mistral: "MISTRAL_API_KEY",
    minimax: "MINIMAX_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    moonshotai: "MOONSHOT_API_KEY",
    "moonshotai-cn": "MOONSHOT_API_KEY",
    huggingface: "HF_TOKEN",
    fireworks: "FIREWORKS_API_KEY",
    together: "TOGETHER_API_KEY",
    baseten: "BASETEN_API_KEY",
    opencode: "OPENCODE_API_KEY",
    "opencode-go": "OPENCODE_API_KEY",
    "kimi-coding": "KIMI_API_KEY",
    meta: "META_API_KEY",
    "cloudflare-workers-ai": "CLOUDFLARE_API_KEY",
    "cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",
    xiaomi: "XIAOMI_API_KEY",
    "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
    "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
    "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
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

const AWS_CREDENTIAL_ENV_VARS = [
  "AWS_PROFILE",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
] as const;

const hasVertexAuthentication = (env: ProviderEnv | undefined): boolean =>
  hasVertexAdcCredentials(env) &&
  (hasEnvValue("GOOGLE_CLOUD_PROJECT", env) || hasEnvValue("GCLOUD_PROJECT", env)) &&
  hasEnvValue("GOOGLE_CLOUD_LOCATION", env);

const hasBedrockAuthentication = (env: ProviderEnv | undefined): boolean =>
  hasEnvValue("AWS_PROFILE", env) ||
  (hasEnvValue("AWS_ACCESS_KEY_ID", env) && hasEnvValue("AWS_SECRET_ACCESS_KEY", env)) ||
  AWS_CREDENTIAL_ENV_VARS.some((name) => hasEnvValue(name, env));

const getKey = (provider: string, env?: ProviderEnv): string | undefined => {
  const envKeys = findKeys(provider, env);
  if (envKeys?.[0] !== undefined && envKeys[0] !== "") {
    const apiKeyEnv =
      provider === "anthropic"
        ? envKeys.find((key) => key !== ANTHROPIC_AUTH_TOKEN_ENV)
        : envKeys[0];
    if (apiKeyEnv !== undefined && apiKeyEnv !== "") return getProviderEnvValue(apiKeyEnv, env);
  }

  if (provider === "google-vertex" && hasVertexAuthentication(env)) return "<authenticated>";
  if (provider === "amazon-bedrock" && hasBedrockAuthentication(env)) return "<authenticated>";
  return undefined;
};

export const getEnvApiKey: {
  (env?: ProviderEnv): (provider: string) => string | undefined;
  (provider: string, env?: ProviderEnv): string | undefined;
} = Function.dual(isProviderFirst, getKey);
