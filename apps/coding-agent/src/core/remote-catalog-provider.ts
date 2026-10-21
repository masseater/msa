import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import platform from "./platform.ts";
import type remoteCatalogProviderTypes from "./remote-catalog-provider.types.ts";
import remoteCatalog from "./remote-catalog.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { nowMs } = platform;
const { isModelType } = ai;
const {
  DEFAULT_CATALOG_BASE_URL,
  REMOTE_CATALOG_MODEL_TYPES,
  isNewer,
  mergeModels,
  readCatalog,
  remoteModels,
  requestCatalog,
} = remoteCatalog;

const REMOTE_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

type RefreshContext = Parameters<NonNullable<aiTypes.Provider["refreshModels"]>>[0];
type SetModels = (models: readonly aiTypes.AnyModel[]) => () => void;

interface RefreshInput {
  providerId: string;
  catalogBaseUrl: string;
  localGeneratedAt: number | undefined;
  context: RefreshContext;
  setModels: SetModels;
}

const isFresh = (stored: aiTypes.ModelsStoreEntry | undefined, force: boolean | undefined) =>
  force !== true &&
  stored?.checkedAt !== undefined &&
  stored.lastModified !== undefined &&
  nowMs() - stored.checkedAt < REMOTE_CATALOG_REFRESH_INTERVAL_MS;

function* publishCatalogResponse(input: RefreshInput, response: Response) {
  const { context, providerId } = input;
  const { stored } = context;
  const checkedAt = nowMs();
  if (response.status === 304 && stored !== undefined) {
    yield* awaited(context.publish({ persist: { ...stored, checkedAt } }));
    return;
  }
  if (response.status === 404 || response.status === 501) {
    const { etag: _etag, ...withoutEtag }: aiTypes.ModelsStoreEntry = stored ?? { models: [] };
    yield* awaited(context.publish({ persist: { ...withoutEtag, checkedAt, lastModified: 0 } }));
    return;
  }
  if (!response.ok) {
    yield* awaited(context.publish({ persist: { ...(stored ?? { models: [] }), checkedAt } }));
    throw new Error(`Model catalog request failed for ${providerId}: ${response.status}`);
  }
  const catalog = yield* performed(readCatalog(providerId, response));
  if (context.signal.aborted) return;
  const entry: aiTypes.ModelsStoreEntry = { ...catalog, checkedAt };
  yield* awaited(
    context.publish({
      persist: entry,
      update: input.setModels(remoteModels(entry, input.localGeneratedAt)),
    }),
  );
}

const refreshRemoteCatalog = (input: RefreshInput) =>
  awaiting(function* () {
    const { context } = input;
    const { stored } = context;
    const restored = remoteModels(stored, input.localGeneratedAt).filter(
      (model) => model.provider === input.providerId,
    );
    if (!(yield* awaited(context.publish({ update: input.setModels(restored) })))) return;
    if (!context.allowNetwork || context.signal.aborted || isFresh(stored, context.force)) return;
    const validator = stored !== undefined && stored.models.length > 0 ? stored.etag : undefined;
    const response = yield* awaited(
      requestCatalog(input.providerId, input.catalogBaseUrl, context.signal, validator),
    );
    if (context.signal.aborted) return;
    yield* publishCatalogResponse(input, response);
  });

function withRemoteCatalog(
  provider: aiTypes.Provider,
  catalogBaseUrl: string = DEFAULT_CATALOG_BASE_URL,
  localGeneratedAt?: number,
): aiTypes.Provider {
  let dynamicModels: readonly aiTypes.AnyModel[] = [];
  const setModels: SetModels = (models) => () => {
    dynamicModels = models;
  };
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
        refreshRemoteCatalog({
          catalogBaseUrl,
          context,
          localGeneratedAt,
          providerId: provider.id,
          setModels,
        }),
      ),
  };
}

function* fetchNewerCatalog(input: RefreshInput) {
  const { context, providerId } = input;
  const response = yield* awaited(requestCatalog(providerId, input.catalogBaseUrl, context.signal));
  if (context.signal.aborted) return undefined;
  if (response.status === 404 || response.status === 501) return [];
  if (!response.ok) {
    throw new Error(`Model catalog request failed for ${providerId}: ${response.status}`);
  }
  const catalog = yield* performed(readCatalog(providerId, response));
  return isNewer(catalog.lastModified, input.localGeneratedAt) ? catalog.models : [];
}

const refreshPersonalizedCatalog = (
  input: RefreshInput,
  personalize: remoteCatalogProviderTypes.PersonalizeCatalog,
  builtinModels: () => readonly aiTypes.AnyModel[],
) =>
  awaiting(function* () {
    const { context } = input;
    const restored = (context.stored?.models ?? []).filter(
      (model) => model.provider === input.providerId,
    );
    if (!(yield* awaited(context.publish({ update: input.setModels(restored) })))) return;
    if (!context.allowNetwork || context.signal.aborted) return;
    const remote = yield* fetchNewerCatalog(input);
    if (remote === undefined) return;
    const personalized = yield* awaited(personalize(mergeModels(builtinModels(), remote), context));
    if (context.signal.aborted) return;
    yield* awaited(
      context.publish({
        persist: { checkedAt: nowMs(), models: personalized },
        update: input.setModels(personalized),
      }),
    );
  });

function withPersonalizedCatalog(
  provider: aiTypes.Provider,
  personalize: remoteCatalogProviderTypes.PersonalizeCatalog,
  catalogBaseUrl: string = DEFAULT_CATALOG_BASE_URL,
  localGeneratedAt?: number,
): aiTypes.Provider {
  let personalModels: readonly aiTypes.AnyModel[] = [];
  const setModels: SetModels = (models) => () => {
    personalModels = models;
  };
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
        refreshPersonalizedCatalog(
          { catalogBaseUrl, context, localGeneratedAt, providerId: provider.id, setModels },
          personalize,
          builtinModels,
        ),
      ),
  };
}

const remoteCatalogProvider = {
  REMOTE_CATALOG_MODEL_TYPES,
  REMOTE_CATALOG_REFRESH_INTERVAL_MS,
  withPersonalizedCatalog,
  withRemoteCatalog,
};

export default remoteCatalogProvider;
