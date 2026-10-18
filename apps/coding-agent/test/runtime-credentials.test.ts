import type { CredentialStore } from "@msa/ai";
import { awaited, runTest, currentTimeMillis, abortController } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { RuntimeCredentials } from "../src/core/runtime-credentials.ts";

describe("RuntimeCredentials", () => {
  test("runtime overrides mask stored credentials without persisting", () =>
    runTest(
      Effect.gen(function* () {
        const storage = AuthStorage.inMemory({
          anthropic: { type: "api_key" as const, key: "stored-key" },
        });
        const credentials = new RuntimeCredentials(storage);

        credentials.setRuntimeApiKey("anthropic", "runtime-key");
        expect(yield* awaited(credentials.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "runtime-key",
        });
        expect(yield* awaited(storage.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "stored-key",
        });

        credentials.removeRuntimeApiKey("anthropic");
        expect(yield* awaited(credentials.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "stored-key",
        });
      }),
    ));

  test("enumeration merges overrides without exposing keys", () =>
    runTest(
      Effect.gen(function* () {
        const storage = AuthStorage.inMemory({
          anthropic: {
            type: "oauth" as const,
            access: "access",
            refresh: "refresh",
            expires: currentTimeMillis() + 60_000,
          },
        });
        const credentials = new RuntimeCredentials(storage);
        credentials.setRuntimeApiKey("anthropic", "runtime-key");
        credentials.setRuntimeApiKey("openai", "other-runtime-key");

        expect(yield* awaited(credentials.list())).toEqual([
          { providerId: "anthropic", type: "api_key" as const },
          { providerId: "openai", type: "api_key" as const },
        ]);
      }),
    ));

  test("forwards operation signals to the persistent store", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const controller = abortController();
        const received: AbortSignal[] = [];
        const storage: CredentialStore = {
          read: (_providerId, options) =>
            effectRunPromise(
              Effect.gen(function* () {
                received.push(options?.signal as AbortSignal);
                return yield* awaited(undefined);
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
          delete: (_providerId, options) =>
            effectRunPromise(
              Effect.sync(() => {
                received.push(options?.signal as AbortSignal);
              }),
            ),
        };
        const credentials = new RuntimeCredentials(storage);

        yield* awaited(credentials.read("anthropic", { signal: controller.signal }));
        yield* awaited(credentials.list({ signal: controller.signal }));
        yield* awaited(
          credentials.modify("anthropic", () => effectRunPromise(awaited(undefined)), {
            signal: controller.signal,
          }),
        );
        yield* awaited(credentials.delete("anthropic", { signal: controller.signal }));

        expect(received).toEqual([
          controller.signal,
          controller.signal,
          controller.signal,
          controller.signal,
        ]);
      }),
    ));

  test("keeps a runtime override when persistent deletion is cancelled", () =>
    runTest(
      Effect.gen(function* () {
        const aborted = new Error("cancelled");
        aborted.name = "AbortError";
        const storage = AuthStorage.inMemory({
          anthropic: { type: "api_key" as const, key: "stored-key" },
        });
        const deleteSpy = vi.spyOn(storage, "delete").mockRejectedValueOnce(aborted);
        const credentials = new RuntimeCredentials(storage);
        credentials.setRuntimeApiKey("anthropic", "runtime-key");

        yield* awaited(
          expect(
            credentials.delete("anthropic", { signal: abortController().signal }),
          ).rejects.toBe(aborted),
        );
        expect(deleteSpy).toHaveBeenCalledTimes(1);
        expect(yield* awaited(credentials.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "runtime-key",
        });
      }),
    ));

  test("delete clears both the override and persisted credential", () =>
    runTest(
      Effect.gen(function* () {
        const storage = AuthStorage.inMemory({
          anthropic: { type: "api_key" as const, key: "stored-key" },
        });
        const credentials = new RuntimeCredentials(storage);
        credentials.setRuntimeApiKey("anthropic", "runtime-key");

        yield* awaited(credentials.delete("anthropic"));

        expect(yield* awaited(credentials.read("anthropic"))).toBeUndefined();
        expect(yield* awaited(credentials.list())).toEqual([]);
      }),
    ));
});
