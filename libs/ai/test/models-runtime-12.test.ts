import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { envKeyAuth, storeCredential, testOAuth, testProvider } = modelsRuntimeSupport;
const runsProviderLoginAndLogoutThrough = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const apiKey = envKeyAuth(undefined);
      apiKey.login = () => Promise.resolve({ key: "logged-in", type: "api_key" });
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { apiKey }, id: "p1" }));

      const credential = yield* Effect.promise(() =>
        models.login("p1", "api_key", {
          notify: () => {},
          prompt: () => Promise.resolve("unused"),
        }),
      );
      expect(credential).toEqual({ key: "logged-in", type: "api_key" });
      expect(yield* Effect.promise(() => credentials.read("p1"))).toEqual(credential);

      yield* Effect.promise(() => models.logout("p1"));
      expect(yield* Effect.promise(() => credentials.read("p1"))).toBeUndefined();
    }),
  );

const aStoredCredentialWithoutAMatching = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { apiKey: envKeyAuth("env-key") }, id: "p1" }));
      yield* storeCredential(credentials, "p1", {
        access: "a",
        expires: 0,
        refresh: "r",
        type: "oauth",
      });

      expect(yield* Effect.promise(() => models.getAuth("p1"))).toBeUndefined();
    }),
  );

const refreshesExpiredOauthCredentialsAndPersists = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const oauth = testOAuth({
        refresh: (credential) =>
          Promise.resolve({
            ...credential,
            access: "new-token",
            expires: currentTimeMillis() + 60 * 60_000,
          }),
      });
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { oauth }, id: "p1" }));
      yield* storeCredential(credentials, "p1", {
        access: "old-token",
        expires: 0,
        refresh: "r",
        type: "oauth",
      });

      const resolution = yield* Effect.promise(() => models.getAuth("p1"));
      expect(resolution?.auth.apiKey).toBe("new-token");
      expect(
        ((yield* Effect.promise(() => credentials.read("p1"))) as { access: string }).access,
      ).toBe("new-token");
    }),
  );

describe("Models runtime", () => {
  it(
    "runs provider login and logout through the credential store",
    runsProviderLoginAndLogoutThrough,
  );

  it(
    "a stored credential without a matching handler blocks ambient fallback",
    aStoredCredentialWithoutAMatching,
  );
});

describe("Models runtime", () => {
  it(
    "refreshes expired oauth credentials and persists the rotated credential",
    refreshesExpiredOauthCredentialsAndPersists,
  );
});
