import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import credentialStore from "../src/auth/credential-store.ts";
import type typesModule from "../src/auth/types.ts";
import modelsModule from "../src/models.ts";
import clock from "../src/utils/clock.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { InMemoryCredentialStore } = credentialStore;
const { createModels } = modelsModule;
const { currentTimeMillis } = clock;

const { envKeyAuth, storeCredential, testModel, testOAuth, testProvider } = modelsRuntimeSupport;
const serializesConcurrentOAuthRefreshesThroughStore = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context();
      const credentials = new InMemoryCredentialStore();
      yield* storeCredential(credentials, "p1", {
        access: "old",
        expires: 0,
        refresh: "r1",
        type: "oauth",
      });

      const refreshes = { value: 0 };
      const oauth = testOAuth({
        refresh: () =>
          Effect.runPromiseWith(effectContext)(
            Effect.gen(function* () {
              refreshes.value++;
              yield* Effect.sleep(10);
              return {
                access: `new-${refreshes.value}`,
                expires: (yield* Clock.currentTimeMillis) + 60 * 60_000,
                refresh: "r2",
                type: "oauth",
              };
            }),
          ),
      });
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { oauth }, id: "p1" }));
      const model = testModel("p1", "model-a");

      const [a, b] = yield* Effect.promise(() =>
        Promise.all([models.getAuth(model.provider), models.getAuth(model.provider)]),
      );
      expect(refreshes.value).toBe(1);
      expect(a?.auth.apiKey).toBe("new-1");
      expect(b?.auth.apiKey).toBe("new-1");
    }),
  );

const validOauthTokensResolveWithoutTouching = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const modifies = { value: 0 };
      const base = new InMemoryCredentialStore();
      const credentials: typesModule.CredentialStore = {
        delete: (pid) => base.delete(pid),
        list: () => base.list(),
        modify: (pid, fn) => {
          modifies.value++;
          return base.modify(pid, fn);
        },
        read: (pid) => base.read(pid),
      };
      yield* storeCredential(base, "p1", {
        access: "valid",
        expires: currentTimeMillis() + 10 * 60_000,
        refresh: "r",
        type: "oauth",
      });
      const models = createModels({ credentials });
      models.setProvider(testProvider({ auth: { oauth: testOAuth() }, id: "p1" }));

      expect((yield* Effect.promise(() => models.getAuth("p1")))?.auth.apiKey).toBe("valid");
      expect(modifies.value).toBe(0);
    }),
  );

const wrapsCredentialStoreFailuresInModelsError = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const readFailing: typesModule.CredentialStore = {
        delete: () => Promise.resolve(),
        list: () => Promise.resolve([]),
        modify: () => Promise.resolve(undefined),
        read: () => Promise.reject(new Error("disk on fire")),
      };
      const models = createModels({ credentials: readFailing });
      models.setProvider(testProvider({ auth: { apiKey: envKeyAuth("env-key") }, id: "p1" }));
      yield* Effect.promise(() =>
        expect(models.getAuth("p1")).rejects.toMatchObject({ code: "auth" }),
      );

      const modifyFailing: typesModule.CredentialStore = {
        delete: () => Promise.resolve(),
        list: () => Promise.resolve([{ providerId: "p1", type: "oauth" }]),
        modify: () => Promise.reject(new Error("disk on fire")),
        read: () => Promise.resolve({ access: "old", expires: 0, refresh: "r", type: "oauth" }),
      };
      const oauthModels = createModels({ credentials: modifyFailing });
      oauthModels.setProvider(testProvider({ auth: { oauth: testOAuth() }, id: "p1" }));
      yield* Effect.promise(() =>
        expect(oauthModels.getAuth("p1")).rejects.toMatchObject({ code: "auth" }),
      );
    }),
  );

describe("Models runtime", () => {
  it(
    "serializes concurrent OAuth refreshes through store.modify (no double refresh)",
    serializesConcurrentOAuthRefreshesThroughStore,
  );
});

describe("Models runtime", () => {
  it("valid oauth tokens resolve without touching modify", validOauthTokensResolveWithoutTouching);
});

describe("Models runtime", () => {
  it("wraps credential store failures in ModelsError", wrapsCredentialStoreFailuresInModelsError);
});
