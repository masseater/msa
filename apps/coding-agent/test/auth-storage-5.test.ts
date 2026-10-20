import { type CredentialStore, type Provider, createModels } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";

const {
  abortController,
  awaited,
  currentTimeMillis,
  deferredPromise,
  makeDirectory,
  randomSuffixSync,
  removePath,
  runTest,
  tempPath,
} = testing;

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

const preservesTheStoredCredentialAfterCancellingAn = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const previous = {
        access: "expired",
        expires: 0,
        refresh: "refresh-token",
        type: "oauth" as const,
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
        effectRunPromise(awaited({ key: "other", type: "api_key" as const })),
      );
      const competing = storage.modify("other", competingMutation);
      yield* Effect.sleep(0);
      expect(competingMutation).not.toHaveBeenCalled();

      blocked.resolve(undefined);
      yield* awaited(competing);
      expect(competingMutation).toHaveBeenCalledTimes(1);
      expect(yield* awaited(storage.read("oauth"))).toEqual(previous);
    }),
  );

const translatesACredentialStoreRefreshFailureAndPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const providerId = "oauth-provider";
    const base = AuthStorage.inMemory({
      [providerId]: {
        access: "expired-access",
        expires: 0,
        refresh: "refresh-token",
        type: "oauth" as const,
      },
    });
    let failNextModify = true;
    const credentials: CredentialStore = {
      delete: (id) => base.delete(id),
      list: () => base.list(),
      modify: (id, fn) => {
        if (failNextModify) {
          failNextModify = false;
          return Promise.reject(new Error("credential store unavailable"));
        }
        return base.modify(id, fn);
      },
      read: (id) => base.read(id),
    };
    return { credentials, effectRunPromise, providerId };
  });

const translatesACredentialStoreRefreshFailureAnd = () =>
  runTest(
    Effect.gen(function* () {
      const { credentials, effectRunPromise, providerId } =
        yield* translatesACredentialStoreRefreshFailureAndPart1();
      const provider: Provider = {
        auth: {
          oauth: {
            login: () =>
              effectRunPromise(
                Effect.sync(() => {
                  throw new Error("not used");
                }),
              ),
            name: "OAuth",
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
        id: providerId,
        name: "OAuth Provider",
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
  );

describe("AuthStorage credential refresh", () => {
  test(
    "preserves the stored credential after cancelling an active refresh mutation",
    preservesTheStoredCredentialAfterCancellingAn,
  );

  test(
    "translates a credential-store refresh failure and allows a later retry",
    translatesACredentialStoreRefreshFailureAnd,
  );
});
