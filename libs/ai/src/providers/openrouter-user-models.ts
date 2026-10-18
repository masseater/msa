import { Effect, Function } from "effect";

import type { RefreshModelsContext } from "../models.ts";
import type { AnyModel } from "../types.ts";
import { httpRequest } from "../utils/http.ts";
import { decodeJsonOrDie } from "../utils/json-codec.ts";
import { isModelType } from "../utils/model-operations.ts";
import { OPENROUTER_BASE_URL, type OpenRouterModel, openRouterCost } from "./openrouter-api.ts";

const OPENROUTER_USER_MODELS_TIMEOUT_MS = 15_000;

const requestUserModels = Effect.fn("requestUserModels")(function* (
  key: string,
  context: RefreshModelsContext,
) {
  const reply = yield* httpRequest({
    url: `${(context.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/u, "")}/models/user`,
    headers: { accept: "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.any([
      context.signal,
      AbortSignal.timeout(OPENROUTER_USER_MODELS_TIMEOUT_MS),
    ]),
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
  catalog: readonly AnyModel[],
  context: RefreshModelsContext,
) {
  const key =
    context.credential?.type === "oauth" ? context.credential.access : context.credential?.key;
  if (key === undefined || key === "") return catalog;
  const entries = yield* requestUserModels(key, context);
  if (entries === undefined) return catalog;
  return restrictCatalog(catalog, entries);
});

export const personalizeOpenRouterCatalog: {
  (context: RefreshModelsContext): (catalog: readonly AnyModel[]) => Promise<readonly AnyModel[]>;
  (catalog: readonly AnyModel[], context: RefreshModelsContext): Promise<readonly AnyModel[]>;
} = Function.dual(
  2,
  function (
    catalog: readonly AnyModel[],
    context: RefreshModelsContext,
  ): Promise<readonly AnyModel[]> {
    return Effect.runPromise(personalizeCatalog(catalog, context));
  },
);

function restrictCatalog(
  catalog: readonly AnyModel[],
  entries: readonly unknown[],
): readonly AnyModel[] {
  const allowed = new Map<string, OpenRouterModel>();
  for (const entry of entries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "id" in entry &&
      typeof entry.id === "string"
    ) {
      allowed.set(entry.id, entry as OpenRouterModel);
    }
  }
  return catalog.flatMap((model): AnyModel[] => {
    if (!isModelType(model, "chat")) return [model];
    const entry = allowed.get(model.id);
    if (entry === undefined) return [];
    return [
      {
        ...model,
        contextWindow:
          entry.top_provider?.context_length || entry.context_length || model.contextWindow,
        maxTokens: entry.top_provider?.max_completion_tokens || model.maxTokens,
        cost: entry.pricing === undefined ? model.cost : openRouterCost(entry.pricing),
      },
    ];
  });
}
