import {
  type AnyModel,
  getModelType,
  isModelType,
  type ModelsStoreEntry,
  type ModelType,
  type Provider,
  type RefreshModelsContext,
} from "@msa/ai";

import { VERSION } from "../config.ts";
import { fetchWithRetry } from "../utils/management-http.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";

const DEFAULT_CATALOG_BASE_URL = "https://pi.dev";
const REMOTE_CATALOG_ATTEMPT_TIMEOUT_MS = 4_000;
export const REMOTE_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const REMOTE_CATALOG_MODEL_TYPES: readonly ModelType[] = ["chat", "image", "classifier"];

function isSupportedModelType(model: { type?: unknown }): boolean {
  return (
    model.type === undefined ||
    (typeof model.type === "string" && REMOTE_CATALOG_MODEL_TYPES.includes(model.type as ModelType))
  );
}

function mergeModels<TModel extends AnyModel>(
  baseline: readonly TModel[],
  dynamic: readonly TModel[],
): TModel[] {
  const merged = new Map<string, TModel>();
  for (const model of [...baseline, ...dynamic])
    merged.set(`${getModelType(model)}\0${model.id}`, model);
  return [...merged.values()];
}

function parseCatalog(providerId: string, value: unknown): AnyModel[] {
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
    .map((model) => ({ ...model, provider: providerId }) as AnyModel);
}

async function readCatalog(
  providerId: string,
  response: Response,
): Promise<{ models: AnyModel[]; lastModified: number; etag?: string }> {
  const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
  const etag = response.headers.get("etag");
  return {
    models: parseCatalog(providerId, await response.json()),
    lastModified: Number.isNaN(lastModified) ? 0 : lastModified,
    ...(etag === null ? {} : { etag }),
  };
}

function isNewer(lastModified: number | undefined, localGeneratedAt: number | undefined): boolean {
  return (
    localGeneratedAt === undefined ||
    (lastModified !== undefined && lastModified > localGeneratedAt)
  );
}

function remoteModels(
  entry: ModelsStoreEntry | undefined,
  localGeneratedAt: number | undefined,
): readonly AnyModel[] {
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
        accept: "application/json",
        "User-Agent": getMsaUserAgent(VERSION),
        ...(validator !== undefined && validator !== "" ? { "if-none-match": validator } : {}),
      },
      signal,
    },
    { attemptTimeoutMs: REMOTE_CATALOG_ATTEMPT_TIMEOUT_MS },
  );
}

export type PersonalizeCatalog = (
  catalog: readonly AnyModel[],
  context: RefreshModelsContext,
) => Promise<readonly AnyModel[]>;

export function withRemoteCatalog(
  provider: Provider,
  catalogBaseUrl: string = DEFAULT_CATALOG_BASE_URL,
  localGeneratedAt?: number,
): Provider {
  let dynamicModels: readonly AnyModel[] = [];

  return {
    ...provider,
    getModels: () =>
      mergeModels(
        provider.getModels(),
        dynamicModels.filter((model) => isModelType(model, "chat")),
      ),
    getAllModels: () =>
      mergeModels(provider.getAllModels?.() ?? provider.getModels(), dynamicModels),
    refreshModels: async (context) => {
      const stored = context.stored;
      const restored = remoteModels(stored, localGeneratedAt).filter(
        (model) => model.provider === provider.id,
      );
      if (
        !(await context.publish({
          update: () => {
            dynamicModels = restored;
          },
        }))
      ) {
        return;
      }
      if (!context.allowNetwork || context.signal.aborted) return;
      if (
        context.force !== true &&
        stored?.checkedAt !== undefined &&
        stored.lastModified !== undefined &&
        Date.now() - stored.checkedAt < REMOTE_CATALOG_REFRESH_INTERVAL_MS
      ) {
        return;
      }

      const validator = stored !== undefined && stored.models.length > 0 ? stored.etag : undefined;
      const response = await requestCatalog(provider.id, catalogBaseUrl, context.signal, validator);
      if (context.signal.aborted) return;
      const checkedAt = Date.now();
      if (response.status === 304 && stored !== undefined) {
        await context.publish({ persist: { ...stored, checkedAt } });
        return;
      }
      if (response.status === 404 || response.status === 501) {
        const { etag: _etag, ...withoutEtag }: ModelsStoreEntry = stored ?? { models: [] };
        await context.publish({ persist: { ...withoutEtag, checkedAt, lastModified: 0 } });
        return;
      }
      if (!response.ok) {
        await context.publish({ persist: { ...(stored ?? { models: [] }), checkedAt } });
        throw new Error(`Model catalog request failed for ${provider.id}: ${response.status}`);
      }
      const catalog = await readCatalog(provider.id, response);
      if (context.signal.aborted) return;
      const entry: ModelsStoreEntry = { ...catalog, checkedAt };
      const published = remoteModels(entry, localGeneratedAt);
      await context.publish({
        persist: entry,
        update: () => {
          dynamicModels = published;
        },
      });
    },
  };
}

export function withPersonalizedCatalog(
  provider: Provider,
  personalize: PersonalizeCatalog,
  catalogBaseUrl: string = DEFAULT_CATALOG_BASE_URL,
  localGeneratedAt?: number,
): Provider {
  let personalModels: readonly AnyModel[] = [];
  const builtinModels = (): readonly AnyModel[] =>
    provider.getAllModels?.() ?? provider.getModels();
  const getAllModels = (): readonly AnyModel[] =>
    personalModels.length > 0 ? personalModels : builtinModels();

  return {
    ...provider,
    getModels: () => getAllModels().filter((model) => isModelType(model, "chat")),
    getAllModels,
    refreshModels: async (context) => {
      const restored = (context.stored?.models ?? []).filter(
        (model) => model.provider === provider.id,
      );
      if (
        !(await context.publish({
          update: () => {
            personalModels = restored;
          },
        }))
      ) {
        return;
      }
      if (!context.allowNetwork || context.signal.aborted) return;

      const response = await requestCatalog(provider.id, catalogBaseUrl, context.signal);
      if (context.signal.aborted) return;
      let remote: readonly AnyModel[] = [];
      if (response.status !== 404 && response.status !== 501) {
        if (!response.ok)
          throw new Error(`Model catalog request failed for ${provider.id}: ${response.status}`);
        const catalog = await readCatalog(provider.id, response);
        if (isNewer(catalog.lastModified, localGeneratedAt)) remote = catalog.models;
      }
      const personalized = await personalize(mergeModels(builtinModels(), remote), context);
      if (context.signal.aborted) return;
      await context.publish({
        persist: { models: personalized, checkedAt: Date.now() },
        update: () => {
          personalModels = personalized;
        },
      });
    },
  };
}
