import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import credentialStore from "../src/auth/credential-store.ts";
import modelsModule from "../src/models.ts";
import clock from "../src/utils/clock.ts";
import modelsRuntimeSupport from "./models-runtime-support.ts";

const { InMemoryCredentialStore } = credentialStore;
const { createModels } = modelsModule;
const { currentTimeMillis } = clock;

const { storeCredential, testOAuth, testProvider } = modelsRuntimeSupport;
const cancelsQueuedCredentialMutationsWithoutRunning = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      const credentials = new InMemoryCredentialStore();
      const firstBlocked = Promise.withResolvers<void>();
      const secondRan = { value: false };
      const first = credentials.modify("p1", () =>
        firstBlocked.promise.then(() => ({ key: "first", type: "api_key" as const })),
      );
      const second = credentials.modify(
        "p1",
        () => {
          secondRan.value = true;
          return Promise.resolve({ key: "second", type: "api_key" });
        },
        { signal: controller.signal },
      );

      controller.abort();
      yield* Effect.promise(() => expect(second).rejects.toMatchObject({ name: "AbortError" }));
      firstBlocked.resolve();
      yield* Effect.promise(() => first);
      yield* Effect.sleep(0);

      expect(secondRan.value).toBe(false);
      expect(yield* Effect.promise(() => credentials.read("p1"))).toEqual({
        key: "first",
        type: "api_key",
      });
    }),
  );
};

const persistsAnOAuthRefreshThatStarted2 = () => {
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
        }),
      );

      yield* Effect.promise(() =>
        expect(models.getAuth("p1", { signal: controller.signal })).rejects.toMatchObject({
          name: "AbortError",
        }),
      );
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          expect(credentials.read("p1")).resolves.toMatchObject({
            refresh: "new-refresh",
          }),
        ),
      );
    }),
  );
};

describe("Models runtime", () => {
  it(
    "cancels queued credential mutations without running them later",
    cancelsQueuedCredentialMutationsWithoutRunning,
  );
});

describe("Models runtime", () => {
  it(
    "persists an OAuth refresh that started before the request was cancelled",
    persistsAnOAuthRefreshThatStarted2,
  );
});
