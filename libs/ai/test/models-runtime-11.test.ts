import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import credentialStore from "../src/auth/credential-store.ts";
import modelsModule from "../src/models.ts";
import clock from "../src/utils/clock.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { InMemoryCredentialStore } = credentialStore;
const { createModels } = modelsModule;
const { currentTimeMillis } = clock;

const { envKeyAuth, storeCredential, testModel, testOAuth, testProvider } = modelsRuntimeSupport;
const resolvesAuthStoredCredentialOwnsThe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const models = createModels({ credentials });
      models.setProvider(
        testProvider({ auth: { apiKey: envKeyAuth("env-key"), oauth: testOAuth() }, id: "p1" }),
      );
      const model = testModel("p1", "model-a");

      expect((yield* Effect.promise(() => models.getAuth(model)))?.auth.apiKey).toBe("env-key");
      expect((yield* Effect.promise(() => models.getAuth(model.provider)))?.auth.apiKey).toBe(
        "env-key",
      );
      expect(
        (yield* Effect.promise(() => models.getAuth(model, { apiKey: "explicit-key" })))?.auth
          .apiKey,
      ).toBe("explicit-key");

      yield* storeCredential(credentials, "p1", {
        access: "oauth-token",
        expires: currentTimeMillis() + 10 * 60_000,
        refresh: "r",
        type: "oauth",
      });
      const resolution = yield* Effect.promise(() => models.getAuth(model.provider));
      expect(resolution?.auth.apiKey).toBe("oauth-token");
      expect(resolution?.source).toBe("OAuth");

      yield* storeCredential(credentials, "p1", { key: "stored-key", type: "api_key" });
      const apiKeyResolution = yield* Effect.promise(() => models.getAuth(model.provider));
      expect(apiKeyResolution?.auth.apiKey).toBe("stored-key");
      expect(apiKeyResolution?.source).toBe("stored");
    }),
  );

const checksProviderAuthWithoutRefreshingOAuth = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const refreshes = { value: 0 };
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { apiKey: envKeyAuth("env-key") }, id: "ambient" }));
      models.setProvider(testProvider({ auth: { apiKey: envKeyAuth(undefined) }, id: "missing" }));
      models.setProvider(
        testProvider({
          auth: {
            oauth: testOAuth({
              refresh: (credential) => {
                refreshes.value++;
                return Promise.resolve(credential);
              },
            }),
          },
          id: "oauth",
        }),
      );
      yield* storeCredential(credentials, "oauth", {
        access: "expired",
        expires: 0,
        refresh: "refresh",
        type: "oauth",
      });

      expect(yield* Effect.promise(() => models.checkAuth("ambient"))).toEqual({
        source: "env",
        type: "api_key",
      });
      expect(yield* Effect.promise(() => models.checkAuth("missing"))).toBeUndefined();
      expect(yield* Effect.promise(() => models.checkAuth("oauth"))).toEqual({
        source: "OAuth",
        type: "oauth",
      });
      expect(refreshes.value).toBe(0);
      expect(
        (yield* Effect.promise(() => models.getAvailable())).map((model) => model.provider),
      ).toEqual(["ambient", "oauth"]);
      expect(
        (yield* Effect.promise(() => models.getAvailable("ambient"))).map(
          (model) => model.provider,
        ),
      ).toEqual(["ambient"]);
    }),
  );

describe("Models runtime", () => {
  it(
    "resolves auth: stored credential owns the provider, ambient only when nothing stored",
    resolvesAuthStoredCredentialOwnsThe,
  );
});

describe("Models runtime", () => {
  it(
    "checks provider auth without refreshing OAuth and filters available models",
    checksProviderAuthWithoutRefreshingOAuth,
  );
});
