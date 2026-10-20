import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import { awaited, awaitingWith } from "./awaiting.ts";

export class RuntimeCredentials implements aiTypes.CredentialStore {
  private readonly store: aiTypes.CredentialStore;
  private readonly overrides = new Map<string, string>();

  constructor(store: aiTypes.CredentialStore) {
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

  read(
    providerId: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        options?.signal?.throwIfAborted();
        const override = this.overrides.get(providerId);
        return yield* awaited(
          override !== undefined && override !== ""
            ? { key: override, type: "api_key" }
            : this.store.read(providerId, options),
        );
      }, this),
    );
  }

  list(options?: aiTypes.AuthOperationOptions): Promise<readonly aiTypes.CredentialInfo[]> {
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
    fn: (current: aiTypes.Credential | undefined) => Promise<aiTypes.Credential | undefined>,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return this.store.modify(providerId, fn, options);
  }

  delete(providerId: string, options?: aiTypes.AuthOperationOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        options?.signal?.throwIfAborted();
        yield* awaited(this.store.delete(providerId, options));
        this.overrides.delete(providerId);
      }, this),
    );
  }
}
