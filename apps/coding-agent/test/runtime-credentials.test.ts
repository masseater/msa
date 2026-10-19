import type { CredentialStore } from "@msa/ai";
import { describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { RuntimeCredentials } from "../src/core/runtime-credentials.ts";

describe("RuntimeCredentials", () => {
  test("runtime overrides mask stored credentials without persisting", async () => {
    const storage = AuthStorage.inMemory({
      "anthropic-api": { type: "api_key", key: "stored-key" },
    });
    const credentials = new RuntimeCredentials(storage);

    credentials.setRuntimeApiKey("anthropic-api", "runtime-key");
    expect(await credentials.read("anthropic-api")).toEqual({
      type: "api_key",
      key: "runtime-key",
    });
    expect(await storage.read("anthropic-api")).toEqual({ type: "api_key", key: "stored-key" });

    credentials.removeRuntimeApiKey("anthropic-api");
    expect(await credentials.read("anthropic-api")).toEqual({ type: "api_key", key: "stored-key" });
  });

  test("enumeration merges overrides without exposing keys", async () => {
    const storage = AuthStorage.inMemory({
      "anthropic-api": {
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 60_000,
      },
    });
    const credentials = new RuntimeCredentials(storage);
    credentials.setRuntimeApiKey("anthropic-api", "runtime-key");
    credentials.setRuntimeApiKey("openai", "other-runtime-key");

    expect(await credentials.list()).toEqual([
      { providerId: "anthropic-api", type: "api_key" },
      { providerId: "openai", type: "api_key" },
    ]);
  });

  test("forwards operation signals to the persistent store", async () => {
    const controller = new AbortController();
    const received: AbortSignal[] = [];
    const storage: CredentialStore = {
      read: async (_providerId, options) => {
        received.push(options?.signal as AbortSignal);
        return undefined;
      },
      list: async (options) => {
        received.push(options?.signal as AbortSignal);
        return [];
      },
      modify: async (_providerId, _fn, options) => {
        received.push(options?.signal as AbortSignal);
        return undefined;
      },
      delete: async (_providerId, options) => {
        received.push(options?.signal as AbortSignal);
      },
    };
    const credentials = new RuntimeCredentials(storage);

    await credentials.read("anthropic-api", { signal: controller.signal });
    await credentials.list({ signal: controller.signal });
    await credentials.modify("anthropic-api", async () => undefined, { signal: controller.signal });
    await credentials.delete("anthropic-api", { signal: controller.signal });

    expect(received).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
  });

  test("keeps a runtime override when persistent deletion is cancelled", async () => {
    const aborted = new Error("cancelled");
    aborted.name = "AbortError";
    const storage = AuthStorage.inMemory({
      "anthropic-api": { type: "api_key", key: "stored-key" },
    });
    const deleteSpy = vi.spyOn(storage, "delete").mockRejectedValueOnce(aborted);
    const credentials = new RuntimeCredentials(storage);
    credentials.setRuntimeApiKey("anthropic-api", "runtime-key");

    await expect(
      credentials.delete("anthropic-api", { signal: new AbortController().signal }),
    ).rejects.toBe(aborted);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(await credentials.read("anthropic-api")).toEqual({
      type: "api_key",
      key: "runtime-key",
    });
  });

  test("delete clears both the override and persisted credential", async () => {
    const storage = AuthStorage.inMemory({
      "anthropic-api": { type: "api_key", key: "stored-key" },
    });
    const credentials = new RuntimeCredentials(storage);
    credentials.setRuntimeApiKey("anthropic-api", "runtime-key");

    await credentials.delete("anthropic-api");

    expect(await credentials.read("anthropic-api")).toBeUndefined();
    expect(await credentials.list()).toEqual([]);
  });
});
