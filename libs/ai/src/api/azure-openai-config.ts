import { Function } from "effect";

import type { Api, Model, StreamOptions } from "../types.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";

const DEFAULT_AZURE_API_VERSION = "v1";

export interface AzureEndpointOptions extends StreamOptions {
  azureApiVersion?: string | undefined;
  azureResourceName?: string | undefined;
  azureBaseUrl?: string | undefined;
  azureDeploymentName?: string | undefined;
}

function parseDeploymentNameMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (value === undefined || value === "") return map;
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const [modelId, deploymentName] = trimmed.split("=", 2);
    if (
      modelId === undefined ||
      modelId === "" ||
      deploymentName === undefined ||
      deploymentName === ""
    )
      continue;
    map.set(modelId.trim(), deploymentName.trim());
  }
  return map;
}

export const resolveDeploymentName: {
  (options?: AzureEndpointOptions): (model: Pick<Model<Api>, "id">) => string;
  (model: Pick<Model<Api>, "id">, options?: AzureEndpointOptions): string;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "id" in args[0],
  function (model: Pick<Model<Api>, "id">, options?: AzureEndpointOptions): string {
    if (options?.azureDeploymentName !== undefined && options?.azureDeploymentName !== "") {
      return options.azureDeploymentName;
    }
    const mappedDeployment = parseDeploymentNameMap(
      getProviderEnvValue("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", options?.env),
    ).get(model.id);
    return mappedDeployment || model.id;
  },
);

function normalizeAzureBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Azure OpenAI base URL: ${baseUrl}`);
  }

  const isAzureHost =
    url.hostname.endsWith(".openai.azure.com") ||
    url.hostname.endsWith(".cognitiveservices.azure.com") ||
    url.hostname.endsWith(".ai.azure.com");
  const normalizedPath = url.pathname.replace(/\/+$/u, "");

  if (
    isAzureHost &&
    (normalizedPath === "" ||
      normalizedPath === "/" ||
      normalizedPath === "/openai" ||
      normalizedPath === "/openai/v1/responses")
  ) {
    url.pathname = "/openai/v1";
    url.search = "";
  }

  return url.toString().replace(/\/+$/u, "");
}

function buildDefaultBaseUrl(resourceName: string): string {
  return `https://${resourceName}.openai.azure.com/openai/v1`;
}

export const resolveAzureBaseUrl: {
  (options?: AzureEndpointOptions): (model: Pick<Model<Api>, "baseUrl">) => string;
  (model: Pick<Model<Api>, "baseUrl">, options?: AzureEndpointOptions): string;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "baseUrl" in args[0],
  function (model: Pick<Model<Api>, "baseUrl">, options?: AzureEndpointOptions): string {
    const baseUrl =
      options?.azureBaseUrl?.trim() ||
      getProviderEnvValue("AZURE_OPENAI_BASE_URL", options?.env)?.trim() ||
      undefined;
    const resourceName =
      options?.azureResourceName || getProviderEnvValue("AZURE_OPENAI_RESOURCE_NAME", options?.env);

    let resolvedBaseUrl = baseUrl;

    if (
      (resolvedBaseUrl === undefined || resolvedBaseUrl === "") &&
      resourceName !== undefined &&
      resourceName !== ""
    ) {
      resolvedBaseUrl = buildDefaultBaseUrl(resourceName);
    }

    if ((resolvedBaseUrl === undefined || resolvedBaseUrl === "") && model.baseUrl !== "") {
      resolvedBaseUrl = model.baseUrl;
    }

    if (resolvedBaseUrl === undefined || resolvedBaseUrl === "") {
      throw new Error(
        "Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or pass azureBaseUrl, azureResourceName, or model.baseUrl.",
      );
    }

    return normalizeAzureBaseUrl(resolvedBaseUrl);
  },
);

export const resolveAzureConfig: {
  (
    options?: AzureEndpointOptions,
  ): (model: Pick<Model<Api>, "baseUrl">) => { baseUrl: string; apiVersion: string };
  (
    model: Pick<Model<Api>, "baseUrl">,
    options?: AzureEndpointOptions,
  ): { baseUrl: string; apiVersion: string };
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null && "baseUrl" in args[0],
  function (
    model: Pick<Model<Api>, "baseUrl">,
    options?: AzureEndpointOptions,
  ): { baseUrl: string; apiVersion: string } {
    return {
      baseUrl: resolveAzureBaseUrl(model, options),
      apiVersion:
        options?.azureApiVersion ||
        getProviderEnvValue("AZURE_OPENAI_API_VERSION", options?.env) ||
        DEFAULT_AZURE_API_VERSION,
    };
  },
);
