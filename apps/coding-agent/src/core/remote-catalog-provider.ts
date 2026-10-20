import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import { VERSION } from "../config.ts";
import { fetchWithRetry } from "../utils/management-http.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import { awaited, awaiting, performed } from "./awaiting.ts";
import { nowMs } from "./platform.ts";

const { getModelType, isModelType } = ai;

const DEFAULT_CATALOG_BASE_URL = "https://pi.dev";
const REMOTE_CATALOG_ATTEMPT_TIMEOUT_MS = 4_000;
export const REMOTE_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const REMOTE_CATALOG_MODEL_TYPES: readonly aiTypes.ModelType[] = [
  "chat",
  "image",
  "classifier",
];

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

export type PersonalizeCatalog = (
  catalog: readonly aiTypes.AnyModel[],
  context: aiTypes.RefreshModelsContext,
) => Promise<readonly aiTypes.AnyModel[]>;

export function withRemoteCatalog(
  provider: aiTypes.Provider,
  catalogBaseUrl: string = DEFAULT_CATALOG_BASE_URL,
  localGeneratedAt?: number,
): aiTypes.Provider {
  let dynamicModels: readonly aiTypes.AnyModel[] = [];

  return {
    ...provider,
    getAllModels: () =>
      mergeModels(provider.getAllModels?.() ?? provider.getModels(), dynamicModels),
    getModels: () =>
      mergeModels(
        provider.getModels(),
        dynamicModels.filter((model) => isModelType(model, "chat")),
      ),
    refreshModels: (context) =>
      Effect.runPromise(
        awaiting(function* () {
          const stored = context.stored;
          const restored = remoteModels(stored, localGeneratedAt).filter(
            (model) => model.provider === provider.id,
          );
          if (
            !(yield* awaited(
              context.publish({
                update: () => {
                  dynamicModels = restored;
                },
              }),
            ))
          ) {
            return;
          }
          if (!context.allowNetwork || context.signal.aborted) return;
          if (
            context.force !== true &&
            stored?.checkedAt !== undefined &&
            stored.lastModified !== undefined &&
            nowMs() - stored.checkedAt < REMOTE_CATALOG_REFRESH_INTERVAL_MS
          ) {
            return;
          }

          const validator =
            stored !== undefined && stored.models.length > 0 ? stored.etag : undefined;
          const response = yield* awaited(
            requestCatalog(provider.id, catalogBaseUrl, context.signal, validator),
          );
          if (context.signal.aborted) return;
          const checkedAt = nowMs();
          if (response.status === 304 && stored !== undefined) {
            yield* awaited(context.publish({ persist: { ...stored, checkedAt } }));
            return;
          }
          if (response.status === 404 || response.status === 501) {
            const { etag: _etag, ...withoutEtag }: aiTypes.ModelsStoreEntry = stored ?? {
              models: [],
            };
            yield* awaited(
              context.publish({ persist: { ...withoutEtag, checkedAt, lastModified: 0 } }),
            );
            return;
          }
          if (!response.ok) {
            yield* awaited(
              context.publish({ persist: { ...(stored ?? { models: [] }), checkedAt } }),
            );
            throw new Error(`Model catalog request failed for ${provider.id}: ${response.status}`);
          }
          const catalog = yield* performed(readCatalog(provider.id, response));
          if (context.signal.aborted) return;
          const entry: aiTypes.ModelsStoreEntry = { ...catalog, checkedAt };
          const published = remoteModels(entry, localGeneratedAt);
          yield* awaited(
            context.publish({
              persist: entry,
              update: () => {
                dynamicModels = published;
              },
            }),
          );
        }),
      ),
  };
}

export function withPersonalizedCatalog(
  provider: aiTypes.Provider,
  personalize: PersonalizeCatalog,
  catalogBaseUrl: string = DEFAULT_CATALOG_BASE_URL,
  localGeneratedAt?: number,
): aiTypes.Provider {
  let personalModels: readonly aiTypes.AnyModel[] = [];
  const builtinModels = (): readonly aiTypes.AnyModel[] =>
    provider.getAllModels?.() ?? provider.getModels();
  const getAllModels = (): readonly aiTypes.AnyModel[] =>
    personalModels.length > 0 ? personalModels : builtinModels();

  return {
    ...provider,
    getAllModels,
    getModels: () => getAllModels().filter((model) => isModelType(model, "chat")),
    refreshModels: (context) =>
      Effect.runPromise(
        awaiting(function* () {
          const restored = (context.stored?.models ?? []).filter(
            (model) => model.provider === provider.id,
          );
          if (
            !(yield* awaited(
              context.publish({
                update: () => {
                  personalModels = restored;
                },
              }),
            ))
          ) {
            return;
          }
          if (!context.allowNetwork || context.signal.aborted) return;

          const response = yield* awaited(
            requestCatalog(provider.id, catalogBaseUrl, context.signal),
          );
          if (context.signal.aborted) return;
          let remote: readonly aiTypes.AnyModel[] = [];
          if (response.status !== 404 && response.status !== 501) {
            if (!response.ok)
              throw new Error(
                `Model catalog request failed for ${provider.id}: ${response.status}`,
              );
            const catalog = yield* performed(readCatalog(provider.id, response));
            if (isNewer(catalog.lastModified, localGeneratedAt)) remote = catalog.models;
          }
          const personalized = yield* awaited(
            personalize(mergeModels(builtinModels(), remote), context),
          );
          if (context.signal.aborted) return;
          yield* awaited(
            context.publish({
              persist: { models: personalized, checkedAt: nowMs() },
              update: () => {
                personalModels = personalized;
              },
            }),
          );
        }),
      ),
  };
}
