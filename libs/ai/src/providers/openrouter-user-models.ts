import { Effect, Function } from "effect";

import type modelsTypes from "../models.types.ts";
import type typesModule from "../types.types.ts";
import http from "../utils/http.ts";
import jsonCodec from "../utils/json-codec.ts";
import modelOperations from "../utils/model-operations.ts";
import openrouterApi from "./openrouter-api.ts";
import type openrouterApiTypes from "./openrouter-api.types.ts";

const { httpRequest } = http;
const { OPENROUTER_BASE_URL, openRouterCost } = openrouterApi;
const { decodeJsonOrDie } = jsonCodec;
const { isModelType } = modelOperations;

const OPENROUTER_USER_MODELS_TIMEOUT_MS = 15_000;

const requestUserModels = Effect.fn("requestUserModels")(function* (
  key: string,
  context: modelsTypes.RefreshModelsContext,
) {
  const reply = yield* httpRequest({
    headers: { accept: "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.any([
      context.signal,
      AbortSignal.timeout(OPENROUTER_USER_MODELS_TIMEOUT_MS),
    ]),
    url: `${(context.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/u, "")}/models/user`,
  });
  if (reply.status === 401 || reply.status === 403 || reply.status === 404) return undefined;
  if (!reply.ok)
    return yield* Effect.die(new Error(`OpenRouter model list request failed: ${reply.status}`));
  const body = yield* Effect.flatMap(reply.text, decodeJsonOrDie);
  if (typeof body !== "object" || body === null || !("data" in body) || !Array.isArray(body.data)) {
    return yield* Effect.die(new Error("Invalid OpenRouter model list response"));
  }
  return body.data as unknown[];
});

const personalizeCatalog = Effect.fn("personalizeCatalog")(function* (
  catalog: readonly typesModule.AnyModel[],
  context: modelsTypes.RefreshModelsContext,
) {
  const key =
    context.credential?.type === "oauth" ? context.credential.access : context.credential?.key;
  if (key === undefined || key === "") return catalog;
  const entries = yield* requestUserModels(key, context);
  if (entries === undefined) return catalog;
  return restrictCatalog(catalog, entries);
});

const personalizeOpenRouterCatalog: {
  (
    context: modelsTypes.RefreshModelsContext,
  ): (catalog: readonly typesModule.AnyModel[]) => Promise<readonly typesModule.AnyModel[]>;
  (
    catalog: readonly typesModule.AnyModel[],
    context: modelsTypes.RefreshModelsContext,
  ): Promise<readonly typesModule.AnyModel[]>;
} = Function.dual(
  2,
  function (
    catalog: readonly typesModule.AnyModel[],
    context: modelsTypes.RefreshModelsContext,
  ): Promise<readonly typesModule.AnyModel[]> {
    return Effect.runPromise(personalizeCatalog(catalog, context));
  },
);

function restrictCatalog(
  catalog: readonly typesModule.AnyModel[],
  entries: readonly unknown[],
): readonly typesModule.AnyModel[] {
  const allowed = new Map<string, openrouterApiTypes.OpenRouterModel>();
  for (const entry of entries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "id" in entry &&
      typeof entry.id === "string"
    ) {
      allowed.set(entry.id, entry as openrouterApiTypes.OpenRouterModel);
    }
  }
  return catalog.flatMap((model): typesModule.AnyModel[] => {
    if (!isModelType(model, "chat")) return [model];
    const entry = allowed.get(model.id);
    if (entry === undefined) return [];
    return [
      {
        ...model,
        contextWindow:
          entry.top_provider?.context_length || entry.context_length || model.contextWindow,
        cost: entry.pricing === undefined ? model.cost : openRouterCost(entry.pricing),
        maxTokens: entry.top_provider?.max_completion_tokens || model.maxTokens,
      },
    ];
  });
}

const openrouterUserModels = {
  personalizeOpenRouterCatalog,
};

export default openrouterUserModels;
