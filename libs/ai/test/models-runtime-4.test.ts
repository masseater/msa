import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { type Provider, createModels, createProvider } from "../src/models.ts";
import type { Api, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { envKeyAuth, storeCredential, testModel, testProvider } = modelsRuntimeSupport;
const persistsDynamicCatalogsAndRestoresThem = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const modelsStore = new InMemoryModelsStore();
      yield* storeCredential(credentials, "dynamic", { key: "key", type: "api_key" });
      const createDynamicProvider = (
        fetchModels: (() => Promise<readonly Model<Api>[]>) | undefined,
      ) =>
        createProvider({
          api: {
            stream: () => new AssistantMessageEventStream(),
            streamSimple: () => new AssistantMessageEventStream(),
          },
          auth: { apiKey: envKeyAuth(undefined) },
          fetchModels: fetchModels === undefined ? undefined : () => fetchModels(),
          id: "dynamic",
          models: [],
        });

      const online = createModels({ credentials, modelsStore });
      online.setProvider(
        createDynamicProvider(() => Promise.resolve([testModel("dynamic", "fetched")])),
      );
      expect((yield* Effect.promise(() => online.refresh())).errors.size).toBe(0);
      expect(online.getModel("dynamic", "fetched")).toBeDefined();

      const offline = createModels({ credentials, modelsStore });
      offline.setProvider(createDynamicProvider(() => Promise.reject(new Error("must not fetch"))));
      expect(
        (yield* Effect.promise(() => offline.refresh({ allowNetwork: false }))).errors.size,
      ).toBe(0);
      expect(offline.getModel("dynamic", "fetched")).toBeDefined();
    }),
  );

const passesEffectiveAPIKeyCredentialsAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const effectiveCredential: { value: unknown } = { value: undefined };
      const forceRefresh: { value: boolean | undefined } = { value: undefined };
      const unconfiguredRefreshes = { value: 0 };
      const models = createModels();
      models.setProvider(
        testProvider({
          auth: { apiKey: envKeyAuth("ambient-key") },
          id: "configured",
          refreshModels: (refreshContext) => {
            if (!refreshContext.allowNetwork) return Promise.resolve();
            effectiveCredential.value = refreshContext.credential;
            forceRefresh.value = refreshContext.force;

            return Promise.resolve();
          },
        }),
      );
      models.setProvider(
        testProvider({
          auth: { apiKey: envKeyAuth(undefined) },
          id: "unconfigured",
          refreshModels: ({ allowNetwork }) => {
            if (allowNetwork) unconfiguredRefreshes.value++;

            return Promise.resolve();
          },
        }),
      );

      yield* Effect.promise(() => models.refresh({ force: true }));
      expect(effectiveCredential.value).toEqual({
        env: undefined,
        key: "ambient-key",
        type: "api_key",
      });
      expect(forceRefresh.value).toBe(true);
      expect(unconfiguredRefreshes.value).toBe(0);
    }),
  );

const passesTheRegisteredProviderSBase = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const baseUrls: (string | undefined)[] = [];
      const inner: Provider = {
        ...testProvider({
          id: "dynamic",
          refreshModels: (refreshContext) => {
            baseUrls.push(refreshContext.baseUrl);

            return Promise.resolve();
          },
        }),
        baseUrl: "https://default.example.test/v1",
      };
      const models = createModels();
      models.setProvider({ ...inner, baseUrl: "https://regional.example.test/v1" });

      yield* Effect.promise(() => models.refresh());
      expect(baseUrls).toEqual([
        "https://regional.example.test/v1",
        "https://regional.example.test/v1",
      ]);
    }),
  );

describe("Models runtime", () => {
  it(
    "persists dynamic catalogs and restores them without network access",
    persistsDynamicCatalogsAndRestoresThem,
  );
});

describe("Models runtime", () => {
  it(
    "passes effective API-key credentials and refresh options while skipping unconfigured providers",
    passesEffectiveAPIKeyCredentialsAnd,
  );
});

describe("Models runtime", () => {
  it(
    "passes the registered provider's base URL, including wrapper overrides, to refreshModels",
    passesTheRegisteredProviderSBase,
  );
});
