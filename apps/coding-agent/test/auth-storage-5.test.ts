import { type CredentialStore, createModels, type Provider } from "@msa/ai";
import {
  abortController,
  awaited,
  currentTimeMillis,
  deferredPromise,
  makeDirectory,
  randomSuffixSync,
  removePath,
  runTest,
  tempPath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";

const dir = tempPath(`msa-auth-storage-refresh-${randomSuffixSync()}`);

beforeEach(() => runTest(makeDirectory(dir)));

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* removePath(dir);
      yield* Effect.sync(() => vi.restoreAllMocks());
    }),
  ),
);

describe("AuthStorage credential refresh", () => {
  test("preserves the stored credential after cancelling an active refresh mutation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const previous = {
          type: "oauth" as const,
          access: "expired",
          refresh: "refresh-token",
          expires: 0,
        };
        const storage = AuthStorage.inMemory({ oauth: previous });
        const controller = abortController();
        const started = deferredPromise<void>();
        const blocked = deferredPromise<void>();
        const pending = storage.modify(
          "oauth",
          () =>
            effectRunPromise(
              Effect.gen(function* () {
                started.resolve(undefined);
                yield* awaited(blocked.promise);
                return yield* awaited({
                  ...previous,
                  access: "refreshed",
                  expires: currentTimeMillis() + 60_000,
                });
              }),
            ),
          { signal: controller.signal },
        );

        yield* awaited(started.promise);
        controller.abort();
        yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
        const competingMutation = vi.fn(() =>
          effectRunPromise(awaited({ type: "api_key" as const, key: "other" })),
        );
        const competing = storage.modify("other", competingMutation);
        yield* Effect.sleep(0);
        expect(competingMutation).not.toHaveBeenCalled();

        blocked.resolve(undefined);
        yield* awaited(competing);
        expect(competingMutation).toHaveBeenCalledTimes(1);
        expect(yield* awaited(storage.read("oauth"))).toEqual(previous);
      }),
    ));

  test("translates a credential-store refresh failure and allows a later retry", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const providerId = "oauth-provider";
        const base = AuthStorage.inMemory({
          [providerId]: {
            type: "oauth" as const,
            access: "expired-access",
            refresh: "refresh-token",
            expires: 0,
          },
        });
        let failNextModify = true;
        const credentials: CredentialStore = {
          read: (id) => base.read(id),
          list: () => base.list(),
          modify: (id, fn) => {
            if (failNextModify) {
              failNextModify = false;
              return Promise.reject(new Error("credential store unavailable"));
            }
            return base.modify(id, fn);
          },
          delete: (id) => base.delete(id),
        };
        const provider: Provider = {
          id: providerId,
          name: "OAuth Provider",
          auth: {
            oauth: {
              name: "OAuth",
              login: () =>
                effectRunPromise(
                  Effect.sync(() => {
                    throw new Error("not used");
                  }),
                ),
              refresh: (credential) =>
                effectRunPromise(
                  awaited({
                    ...credential,
                    access: "refreshed-access",
                    expires: currentTimeMillis() + 60_000,
                  }),
                ),
              toAuth: (credential) => effectRunPromise(awaited({ apiKey: credential.access })),
            },
          },
          getModels: () => [],
          stream: () => {
            throw new Error("not used");
          },
          streamSimple: () => {
            throw new Error("not used");
          },
        };
        const models = createModels({ credentials });
        models.setProvider(provider);

        yield* awaited(expect(models.getAuth(providerId)).rejects.toMatchObject({ code: "auth" }));
        yield* awaited(
          expect(models.getAuth(providerId)).resolves.toMatchObject({
            auth: { apiKey: "refreshed-access" },
          }),
        );
      }),
    ));
});
