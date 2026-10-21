import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import type * as Effect from "effect/Effect";

import config from "../config.ts";
import managementHttp from "../utils/management-http.ts";
import userAgent from "../utils/user-agent.ts";
import awaitingModule from "./awaiting.ts";

const { awaited, awaiting } = awaitingModule;
const { fetchWithRetry } = managementHttp;
const { getMsaUserAgent } = userAgent;
const { VERSION } = config;
const { getModelType } = ai;

const DEFAULT_CATALOG_BASE_URL = "https://pi.dev";
const REMOTE_CATALOG_ATTEMPT_TIMEOUT_MS = 4_000;
const REMOTE_CATALOG_MODEL_TYPES: readonly aiTypes.ModelType[] = ["chat", "image", "classifier"];

function isSupportedModelType(model: { type?: unknown }): boolean {
  return (
    model.type === undefined ||
    (typeof model.type === "string" &&
      REMOTE_CATALOG_MODEL_TYPES.includes(model.type as aiTypes.ModelType))
  );
}

function mergeModels<TModel extends aiTypes.AnyModel>(
  baseline: readonly TModel[],
  dynamic: readonly TModel[],
): TModel[] {
  const merged = new Map<string, TModel>();
  for (const model of [...baseline, ...dynamic])
    merged.set(`${getModelType(model)}\0${model.id}`, model);
  return [...merged.values()];
}

function parseCatalog(providerId: string, value: unknown): aiTypes.AnyModel[] {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        "models" in value &&
        Array.isArray(value.models)
      ? value.models
      : typeof value === "object" && value !== null
        ? Object.values(value)
        : undefined;
  if (entries === undefined) throw new Error(`Invalid model catalog for provider "${providerId}"`);
  return entries
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && "id" in entry,
    )
    .filter(isSupportedModelType)
    .map((model) => Object.assign(model, { provider: providerId }) as unknown as aiTypes.AnyModel);
}

function readCatalog(
  providerId: string,
  response: Response,
): Effect.Effect<{ models: aiTypes.AnyModel[]; lastModified: number; etag?: string }> {
  return awaiting(function* () {
    const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
    const etag = response.headers.get("etag");
    return {
      lastModified: Number.isNaN(lastModified) ? 0 : lastModified,
      models: parseCatalog(providerId, yield* awaited(response.json())),
      ...(etag === null ? {} : { etag }),
    };
  });
}

function isNewer(lastModified: number | undefined, localGeneratedAt: number | undefined): boolean {
  return (
    localGeneratedAt === undefined ||
    (lastModified !== undefined && lastModified > localGeneratedAt)
  );
}

function remoteModels(
  entry: aiTypes.ModelsStoreEntry | undefined,
  localGeneratedAt: number | undefined,
): readonly aiTypes.AnyModel[] {
  return entry !== undefined && isNewer(entry.lastModified, localGeneratedAt) ? entry.models : [];
}

function requestCatalog(
  providerId: string,
  catalogBaseUrl: string,
  signal: AbortSignal,
  validator?: string,
): Promise<Response> {
  const url = new URL(`/api/models/providers/${encodeURIComponent(providerId)}`, catalogBaseUrl);
  url.searchParams.set("types", REMOTE_CATALOG_MODEL_TYPES.join(","));
  return fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent": getMsaUserAgent(VERSION),
        accept: "application/json",
        ...(validator !== undefined && validator !== "" ? { "if-none-match": validator } : {}),
      },
      signal,
    },
    { attemptTimeoutMs: REMOTE_CATALOG_ATTEMPT_TIMEOUT_MS },
  );
}

const remoteCatalog = {
  DEFAULT_CATALOG_BASE_URL,
  REMOTE_CATALOG_MODEL_TYPES,
  isNewer,
  mergeModels,
  readCatalog,
  remoteModels,
  requestCatalog,
};

export default remoteCatalog;
