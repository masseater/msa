import { GoogleGenAI, type HttpOptions, ResourceScope } from "@google/genai";

import type { Model, ProviderEnv, ProviderHeaders, StreamOptions } from "../types.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";

const API_VERSION = "v1";
const GCP_VERTEX_CREDENTIALS_MARKER = "gcp-vertex-credentials";

export interface VertexClientOptions extends StreamOptions {
  project?: string | undefined;
  location?: string | undefined;
}

function createClient(
  model: Model<"google-vertex">,
  project: string,
  location: string,
  optionsHeaders?: ProviderHeaders,
  env?: ProviderEnv,
): GoogleGenAI {
  const googleAuthOptions = buildGoogleAuthOptions(env);
  const httpOptions = buildHttpOptions(model, optionsHeaders);
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    apiVersion: API_VERSION,
    ...(googleAuthOptions === undefined ? {} : { googleAuthOptions }),
    ...(httpOptions === undefined ? {} : { httpOptions }),
  });
}

function createClientWithApiKey(
  model: Model<"google-vertex">,
  apiKey: string,
  optionsHeaders?: ProviderHeaders,
): GoogleGenAI {
  const httpOptions = buildHttpOptions(model, optionsHeaders);
  return new GoogleGenAI({
    vertexai: true,
    apiKey,
    apiVersion: API_VERSION,
    ...(httpOptions === undefined ? {} : { httpOptions }),
  });
}

function buildHttpOptions(
  model: Model<"google-vertex">,
  optionsHeaders?: ProviderHeaders,
): HttpOptions | undefined {
  const httpOptions: HttpOptions = {};
  const baseUrl = resolveCustomBaseUrl(model.baseUrl);
  if (baseUrl !== undefined && baseUrl !== "") {
    httpOptions.baseUrl = baseUrl;
    httpOptions.baseUrlResourceScope = ResourceScope.COLLECTION;
    if (baseUrlIncludesApiVersion(baseUrl)) {
      httpOptions.apiVersion = "";
    }
  }

  const headers = providerHeadersToRecord({
    "User-Agent": getMsaUserAgent(),
    ...model.headers,
    ...optionsHeaders,
  });
  if (headers !== undefined) {
    httpOptions.headers = headers;
  }

  return Object.keys(httpOptions).length > 0 ? httpOptions : undefined;
}

function resolveCustomBaseUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim();
  if (trimmed === "" || trimmed.includes("{location}")) {
    return undefined;
  }
  return trimmed;
}

function baseUrlIncludesApiVersion(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.pathname.split("/").some((part) => /^v\d+(?:beta\d*)?$/u.test(part));
  } catch {
    return /(?:^|\/)v\d+(?:beta\d*)?(?:\/|$)/u.test(baseUrl);
  }
}

function buildGoogleAuthOptions(env?: ProviderEnv): { keyFilename: string } | undefined {
  const keyFilename = getProviderEnvValue("GOOGLE_APPLICATION_CREDENTIALS", env);
  return keyFilename !== undefined && keyFilename !== "" ? { keyFilename } : undefined;
}

function resolveApiKey(options?: VertexClientOptions): string | undefined {
  const apiKey = options?.apiKey?.trim();
  if (
    apiKey === undefined ||
    apiKey === "" ||
    apiKey === GCP_VERTEX_CREDENTIALS_MARKER ||
    isPlaceholderApiKey(apiKey)
  ) {
    return undefined;
  }
  return apiKey;
}

function isPlaceholderApiKey(apiKey: string): boolean {
  return /^<[^>]+>$/u.test(apiKey);
}

function resolveProject(options?: VertexClientOptions): string {
  const project =
    options?.project ||
    getProviderEnvValue("GOOGLE_CLOUD_PROJECT", options?.env) ||
    getProviderEnvValue("GCLOUD_PROJECT", options?.env);
  if (project === undefined || project === "") {
    throw new Error(
      "Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or pass project in options.",
    );
  }
  return project;
}

function resolveLocation(options?: VertexClientOptions): string {
  const location = options?.location || getProviderEnvValue("GOOGLE_CLOUD_LOCATION", options?.env);
  if (location === undefined || location === "") {
    throw new Error(
      "Vertex AI requires a location. Set GOOGLE_CLOUD_LOCATION or pass location in options.",
    );
  }
  return location;
}

export const createVertexClient =
  (model: Model<"google-vertex">) =>
  (options: VertexClientOptions | undefined): GoogleGenAI => {
    const apiKey = resolveApiKey(options);
    return apiKey !== undefined && apiKey !== ""
      ? createClientWithApiKey(model, apiKey, options?.headers)
      : createClient(
          model,
          resolveProject(options),
          resolveLocation(options),
          options?.headers,
          options?.env,
        );
  };
