import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { storeCredential, testOAuth, testProvider } = modelsRuntimeSupport;
const refreshesExpiredOAuthBeforeRefreshingModels = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const modelRefreshCredential: { value: unknown } = { value: undefined };
      yield* storeCredential(credentials, "oauth-dynamic", {
        access: "expired",
        expires: 0,
        refresh: "refresh",
        type: "oauth",
      });
      const models = createModels({ credentials });
      models.setProvider(
        testProvider({
          auth: {
            oauth: testOAuth({
              refresh: () =>
                Promise.resolve({
                  access: "fresh",
                  expires: currentTimeMillis() + 60_000,
                  refresh: "rotated",
                  type: "oauth",
                }),
            }),
          },
          id: "oauth-dynamic",
          refreshModels: (refreshContext) => {
            if (refreshContext.allowNetwork)
              modelRefreshCredential.value = refreshContext.credential;

            return Promise.resolve();
          },
        }),
      );

      expect((yield* Effect.promise(() => models.refresh())).errors.size).toBe(0);
      expect(modelRefreshCredential.value).toMatchObject({
        access: "fresh",
        refresh: "rotated",
        type: "oauth",
      });
      expect(yield* Effect.promise(() => credentials.read("oauth-dynamic"))).toMatchObject({
        access: "fresh",
        refresh: "rotated",
      });
    }),
  );

const persistsAnOAuthRefreshThatStarted = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      yield* storeCredential(credentials, "p1", {
        access: "old",
        expires: 0,
        refresh: "old-refresh",
        type: "oauth",
      });
      const models = createModels({ credentials });
      models.setProvider(
        testProvider({
          auth: {
            oauth: testOAuth({
              refresh: (credential) => {
                controller.abort();
                return Promise.resolve({
                  ...credential,
                  access: "new",
                  expires: currentTimeMillis() + 60_000,
                  refresh: "new-refresh",
                });
              },
            }),
          },
          id: "p1",
          refreshModels: () => Promise.resolve(),
        }),
      );

      expect(
        (yield* Effect.promise(() => models.refresh({ signal: controller.signal }))).aborted,
      ).toBe(true);
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          expect(credentials.read("p1")).resolves.toMatchObject({ refresh: "new-refresh" }),
        ),
      );
    }),
  );
};

describe("Models runtime", () => {
  it(
    "refreshes expired OAuth before refreshing models",
    refreshesExpiredOAuthBeforeRefreshingModels,
  );
});

describe("Models runtime", () => {
  it(
    "persists an OAuth refresh that started before the model refresh was cancelled",
    persistsAnOAuthRefreshThatStarted,
  );
});
