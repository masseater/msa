import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { VERSION } from "../src/config.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import modelCatalogProtocol from "./model-catalog-protocol.ts";
import type modelCatalogProtocolTypes from "./model-catalog-protocol.types.ts";
import testNetworkEnv from "./test-network-env.ts";

const { InMemoryCredentialStore } = ai;

const {
  MODEL_CATALOG_INDEX_KEY,
  getModelCatalogProviderKey,
  parseModelCatalogIndex,
  parseModelCatalogRequest,
  selectModelCatalog,
} = modelCatalogProtocol;
const { allowNetwork } = testNetworkEnv;

const { awaited, closeServers, listen, runTest } = testing;

const legacyRevision = `sha256-${"a".repeat(64)}`;
const mixedApiRevision = `sha256-${"b".repeat(64)}`;
const modelId = "anthropic/claude-sonnet-5";

const lastModified = "Thu, 01 Jan 2099 00:00:00 GMT";
const commonModel = {
  contextWindow: 200_000,
  cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
  id: modelId,
  input: ["text"],
  maxTokens: 64_000,
  name: "Claude Sonnet 5",
  provider: "openrouter",
  reasoning: true,
};
const legacyModel = {
  ...commonModel,
  api: "openai-completions",
  baseUrl: "https://openrouter.ai/api/v1",
};
const mixedApiModel = {
  ...commonModel,
  api: "anthropic-messages",
  baseUrl: "https://openrouter.ai/api",
};

const index: modelCatalogProtocolTypes.ModelCatalogIndex = {
  catalogs: [
    { minimumPiVersion: "0.80.7", revision: legacyRevision },
    { minimumPiVersion: "0.85.0", revision: mixedApiRevision },
  ],
  defaultRevision: mixedApiRevision,
  schemaVersion: 1,
};

const objects = new Map<string, unknown>([
  [MODEL_CATALOG_INDEX_KEY, index],
  [getModelCatalogProviderKey(legacyRevision, "openrouter", "legacy"), { [modelId]: legacyModel }],
  [
    getModelCatalogProviderKey(mixedApiRevision, "openrouter", "legacy"),
    { [modelId]: mixedApiModel },
  ],
  [
    getModelCatalogProviderKey(mixedApiRevision, "openrouter", "typed"),
    [{ type: "chat", ...mixedApiModel }],
  ],
]);

const catalogBody = (
  provider: string,
  request: {
    piVersion: string | undefined;
    representation: modelCatalogProtocolTypes.ModelCatalogRepresentation;
  },
) => {
  const catalog = selectModelCatalog(
    parseModelCatalogIndex(objects.get(MODEL_CATALOG_INDEX_KEY)),
    request.piVersion,
  );
  if (catalog === undefined) return undefined;
  const body =
    objects.get(getModelCatalogProviderKey(catalog.revision, provider, request.representation)) ??
    objects.get(getModelCatalogProviderKey(catalog.revision, provider, "legacy"));
  return body === undefined ? undefined : { body, revision: catalog.revision };
};

const catalogResponse = (request: Request): Response => {
  const url = new URL(request.url);
  const provider = /^\/api\/models\/providers\/([^/]+)$/u.exec(url.pathname)?.[1];
  const catalogRequest = parseModelCatalogRequest(
    url,
    request.headers.get("user-agent") ?? undefined,
  );
  if (provider === undefined) return new Response(null, { status: 404 });
  if (catalogRequest.kind === "redirect")
    return new Response(null, {
      headers: { "cache-control": "no-store", location: catalogRequest.location },
      status: 307,
    });
  if (catalogRequest.kind === "invalid") return new Response(catalogRequest.error, { status: 400 });
  const found = catalogBody(provider, catalogRequest);
  if (found === undefined) return new Response(null, { status: 404 });
  return Response.json(found.body, {
    headers: { "last-modified": lastModified, "x-pi-model-catalog-revision": found.revision },
  });
};

const startCatalogServer = (requests: string[]) =>
  listen((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      requests.push(`${url.pathname}${url.search}`);
      return catalogResponse(request);
    }),
  );

const requests2: string[] = [];

let catalogBaseUrl: string;

const partPart1 = () =>
  Effect.gen(function* () {
    allowNetwork();
    const runtime = yield* awaited(
      ModelRuntime.create({
        catalogBaseUrl,
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        refreshOnCreate: false,
      }),
    );
    return { runtime };
  });

const beforeAllHook = Effect.gen(function* () {
  catalogBaseUrl = yield* startCatalogServer(requests2);
});

const captureProviderUrl = Effect.fn("captureProviderUrl")(function* (
  runtime: ModelRuntime,
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>,
) {
  const captured: { url?: URL } = {};
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.url = new URL(new Request(input, init).url);
    throw new Error("Provider request captured");
  });
  yield* awaited(
    runtime.completeSimple(
      model,
      { messages: [{ content: "Hello", role: "user", timestamp: 0 }] },
      { apiKey: "test-key", maxRetries: 0 },
    ),
  ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())));
  return captured.url;
});

const negotiatesTheCatalogForItsVersion = Effect.gen(function* () {
  const { runtime } = yield* partPart1();
  yield* awaited(runtime.setRuntimeApiKey("openrouter", "test-key"));
  const refresh = yield* awaited(
    runtime.refresh({ allowNetwork: true, force: true, providers: ["openrouter"] }),
  );
  expect([...refresh.errors]).toEqual([]);
  const catalogUrl = "/api/models/providers/openrouter?types=chat%2Cimage%2Cclassifier";
  expect(requests2).toEqual([catalogUrl, `${catalogUrl}&pi-version=${VERSION}`]);
  const expectedModel =
    selectModelCatalog(index, VERSION)?.revision === legacyRevision ? legacyModel : mixedApiModel;
  const model = runtime.getModel("openrouter", modelId);
  expect(model).toMatchObject({ api: expectedModel.api, baseUrl: expectedModel.baseUrl });
  if (model === undefined) throw new Error(`Missing model: openrouter/${modelId}`);
  const providerUrl = yield* captureProviderUrl(runtime, model);
  expect(providerUrl?.pathname).toBe(
    expectedModel.api === "anthropic-messages" ? "/api/v1/messages" : "/api/v1/chat/completions",
  );
});

describe("model catalog protocol with the current client", () => {
  beforeAll(() => runTest(beforeAllHook));

  afterAll(() => runTest(closeServers));

  it("negotiates the catalog for its version and reaches the OpenRouter API", () =>
    runTest(negotiatesTheCatalogForItsVersion));
});
