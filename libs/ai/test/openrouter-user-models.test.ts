import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type modelsTypes from "../src/models.types.ts";
import type openrouterApiTypes from "../src/providers/openrouter-api.types.ts";
import openrouterUserModels from "../src/providers/openrouter-user-models.ts";
import type typesModule from "../src/types.types.ts";

const { personalizeOpenRouterCatalog } = openrouterUserModels;

const zeroCost = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };

function chatModel(id: string): typesModule.Model<"openai-completions"> {
  return {
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 200_000,
    cost: { cacheRead: 0.1, cacheWrite: 0, input: 1, output: 2 },
    id,
    input: ["text"],
    maxTokens: 50_000,
    name: id,
    provider: "openrouter",
    reasoning: false,
  };
}

const imageModel: typesModule.ImageModel<"openrouter-images"> = {
  api: "openrouter-images",
  baseUrl: "https://openrouter.ai/api/v1",
  cost: zeroCost,
  id: "image",
  input: ["text"],
  name: "image",
  output: ["image"],
  provider: "openrouter",
  type: "image",
};

const classifierModel: typesModule.ClassifierModel<"typesafe-system-one"> = {
  api: "typesafe-system-one",
  baseUrl: "https://openrouter.ai/api/v1",
  contextWindow: 64_000,
  cost: zeroCost,
  id: "classifier",
  input: ["text"],
  name: "classifier",
  provider: "openrouter",
  type: "classifier",
};

function refreshContext(): modelsTypes.RefreshModelsContext {
  return {
    allowNetwork: true,
    credential: { key: "sk-or-test", type: "api_key" },
    publish: () => Promise.resolve(true),
    signal: new AbortController().signal,
  };
}

function stubUserModels(response: Response): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}

afterEach(() => vi.restoreAllMocks());

const keepsOnlyTheKeySChatData: openrouterApiTypes.OpenRouterModel[] = [
  {
    context_length: 1_000_000,
    id: "listed",
    pricing: { completion: "0.000015", prompt: "0.000003" },
    top_provider: { context_length: 262_144, max_completion_tokens: 32_768 },
  },
  {
    context_length: 0,
    id: "no-limits",
    top_provider: { context_length: null, max_completion_tokens: null },
  },
  { id: "router", pricing: { completion: "-1", prompt: "-1" } },
];

const keepsOnlyTheKeySChat = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const data: openrouterApiTypes.OpenRouterModel[] = keepsOnlyTheKeySChatData;
      stubUserModels(Response.json({ data }));
      const catalog: typesModule.AnyModel[] = [
        chatModel("listed"),
        chatModel("no-limits"),
        chatModel("router"),
        chatModel("blocked"),
        imageModel,
        classifierModel,
      ];

      const result = yield* Effect.promise(() =>
        personalizeOpenRouterCatalog(catalog, refreshContext()),
      );

      expect(result.map((model) => model.id)).toEqual([
        "listed",
        "no-limits",
        "router",
        "image",
        "classifier",
      ]);
      expect(result[0]).toMatchObject({
        contextWindow: 262_144,
        cost: { cacheRead: 0, cacheWrite: 0, input: 3, output: 15 },
        maxTokens: 32_768,
      });
      expect(result[1]).toMatchObject({
        contextWindow: 200_000,
        cost: chatModel("x").cost,
        maxTokens: 50_000,
      });
      expect(result[2]).toMatchObject({ cost: zeroCost });
      expect(result[3]).toBe(imageModel);
      expect(result[4]).toBe(classifierModel);
    }),
  );

describe("personalizeOpenRouterCatalog", () => {
  it("keeps only the key's chat models, with the key's limits and prices", keepsOnlyTheKeySChat);
});

describe("personalizeOpenRouterCatalog", () => {
  it.each([401, 403, 404])(
    "returns the catalog unchanged when the endpoint rejects the key or is missing (%i)",
    (status) =>
      Effect.runPromise(
        Effect.gen(function* () {
          stubUserModels(new Response("", { status }));
          const catalog = [chatModel("a")];

          expect(
            yield* Effect.promise(() => personalizeOpenRouterCatalog(catalog, refreshContext())),
          ).toBe(catalog);
        }),
      ),
  );
});
