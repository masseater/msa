import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { RuntimeCredentials } from "../src/core/runtime-credentials.ts";

const { abortController, awaited, currentTimeMillis, runTest } = testing;

const runtimeOverridesMaskStoredCredentialsWithoutPersisting = () =>
  runTest(
    Effect.gen(function* () {
      const storage = AuthStorage.inMemory({
        "anthropic-api": { key: "stored-key", type: "api_key" as const },
      });
      const credentials = new RuntimeCredentials(storage);

      credentials.setRuntimeApiKey("anthropic-api", "runtime-key");
      expect(yield* awaited(credentials.read("anthropic-api"))).toEqual({
        key: "runtime-key",
        type: "api_key" as const,
      });
      expect(yield* awaited(storage.read("anthropic-api"))).toEqual({
        key: "stored-key",
        type: "api_key" as const,
      });

      credentials.removeRuntimeApiKey("anthropic-api");
      expect(yield* awaited(credentials.read("anthropic-api"))).toEqual({
        key: "stored-key",
        type: "api_key" as const,
      });
    }),
  );

const enumerationMergesOverridesWithoutExposingKeys = () =>
  runTest(
    Effect.gen(function* () {
      const storage = AuthStorage.inMemory({
        "anthropic-api": {
          access: "access",
          expires: currentTimeMillis() + 60_000,
          refresh: "refresh",
          type: "oauth" as const,
        },
      });
      const credentials = new RuntimeCredentials(storage);
      credentials.setRuntimeApiKey("anthropic-api", "runtime-key");
      credentials.setRuntimeApiKey("openai", "other-runtime-key");

      expect(yield* awaited(credentials.list())).toEqual([
        { providerId: "anthropic-api", type: "api_key" as const },
        { providerId: "openai", type: "api_key" as const },
      ]);
    }),
  );

const forwardsOperationSignalsToThePersistentStorePart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const controller = abortController();
    const received: AbortSignal[] = [];
    const storage: aiTypes.CredentialStore = {
      delete: (_providerId, options) =>
        effectRunPromise(
          Effect.sync(() => {
            received.push(options?.signal as AbortSignal);
          }),
        ),
      list: (options) =>
        effectRunPromise(
          Effect.gen(function* () {
            received.push(options?.signal as AbortSignal);
            return yield* awaited([]);
          }),
        ),
      modify: (_providerId, _fn, options) =>
        effectRunPromise(
          Effect.gen(function* () {
            received.push(options?.signal as AbortSignal);
            return yield* awaited(undefined);
          }),
        ),
      read: (_providerId, options) =>
        effectRunPromise(
          Effect.gen(function* () {
            received.push(options?.signal as AbortSignal);
            return yield* awaited(undefined);
          }),
        ),
    };
    return { controller, effectRunPromise, received, storage };
  });

const forwardsOperationSignalsToThePersistentStore = () =>
  runTest(
    Effect.gen(function* () {
      const { controller, effectRunPromise, received, storage } =
        yield* forwardsOperationSignalsToThePersistentStorePart1();
      const credentials = new RuntimeCredentials(storage);

      yield* awaited(credentials.read("anthropic-api", { signal: controller.signal }));
      yield* awaited(credentials.list({ signal: controller.signal }));
      yield* awaited(
        credentials.modify("anthropic-api", () => effectRunPromise(awaited(undefined)), {
          signal: controller.signal,
        }),
      );
      yield* awaited(credentials.delete("anthropic-api", { signal: controller.signal }));

      expect(received).toEqual([
        controller.signal,
        controller.signal,
        controller.signal,
        controller.signal,
      ]);
    }),
  );

const keepsARuntimeOverrideWhenPersistentDeletion = () =>
  runTest(
    Effect.gen(function* () {
      const aborted = new Error("cancelled");
      aborted.name = "AbortError";
      const storage = AuthStorage.inMemory({
        "anthropic-api": { key: "stored-key", type: "api_key" as const },
      });
      const deleteSpy = vi.spyOn(storage, "delete").mockRejectedValueOnce(aborted);
      const credentials = new RuntimeCredentials(storage);
      credentials.setRuntimeApiKey("anthropic-api", "runtime-key");

      yield* awaited(
        expect(
          credentials.delete("anthropic-api", { signal: abortController().signal }),
        ).rejects.toBe(aborted),
      );
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(yield* awaited(credentials.read("anthropic-api"))).toEqual({
        key: "runtime-key",
        type: "api_key" as const,
      });
    }),
  );

const deleteClearsBothTheOverrideAndPersisted = () =>
  runTest(
    Effect.gen(function* () {
      const storage = AuthStorage.inMemory({
        "anthropic-api": { key: "stored-key", type: "api_key" as const },
      });
      const credentials = new RuntimeCredentials(storage);
      credentials.setRuntimeApiKey("anthropic-api", "runtime-key");

      yield* awaited(credentials.delete("anthropic-api"));

      expect(yield* awaited(credentials.read("anthropic-api"))).toBeUndefined();
      expect(yield* awaited(credentials.list())).toEqual([]);
    }),
  );

describe("RuntimeCredentials", () => {
  test(
    "runtime overrides mask stored credentials without persisting",
    runtimeOverridesMaskStoredCredentialsWithoutPersisting,
  );

  test(
    "enumeration merges overrides without exposing keys",
    enumerationMergesOverridesWithoutExposingKeys,
  );

  test(
    "forwards operation signals to the persistent store",
    forwardsOperationSignalsToThePersistentStore,
  );

  test(
    "keeps a runtime override when persistent deletion is cancelled",
    keepsARuntimeOverrideWhenPersistentDeletion,
  );

  test(
    "delete clears both the override and persisted credential",
    deleteClearsBothTheOverrideAndPersisted,
  );
});
