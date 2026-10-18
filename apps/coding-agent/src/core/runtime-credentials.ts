import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@msa/ai";
import * as Effect from "effect/Effect";

import { awaited, awaitingWith } from "./awaiting.ts";

export class RuntimeCredentials implements CredentialStore {
  private readonly store: CredentialStore;
  private readonly overrides = new Map<string, string>();

  constructor(store: CredentialStore) {
    this.store = store;
  }

  setRuntimeApiKey(providerId: string, apiKey: string): void {
    this.overrides.set(providerId, apiKey);
  }

  removeRuntimeApiKey(providerId: string): void {
    this.overrides.delete(providerId);
  }

  hasRuntimeApiKey(providerId: string): boolean {
    return this.overrides.has(providerId);
  }

  read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        options?.signal?.throwIfAborted();
        const override = this.overrides.get(providerId);
        return yield* awaited(
          override !== undefined && override !== ""
            ? { type: "api_key", key: override }
            : this.store.read(providerId, options),
        );
      }, this),
    );
  }

  list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const entries = new Map(
          (yield* awaited(this.store.list(options))).map((entry) => [entry.providerId, entry]),
        );
        options?.signal?.throwIfAborted();
        for (const providerId of this.overrides.keys()) {
          entries.set(providerId, { providerId, type: "api_key" });
        }
        return [...entries.values()];
      }, this),
    );
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.store.modify(providerId, fn, options);
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        options?.signal?.throwIfAborted();
        yield* awaited(this.store.delete(providerId, options));
        this.overrides.delete(providerId);
      }, this),
    );
  }
}
