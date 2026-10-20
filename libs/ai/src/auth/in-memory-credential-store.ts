import { Effect } from "effect";

import abort from "../utils/abort.ts";
import credentialStoreModule from "./credential-store.ts";
import type typesModule from "./types.ts";

const { operationSignal, raceWithAbortSignal } = abort;

export default class InMemoryCredentialStore implements typesModule.CredentialStore {
  private credentials = new Map<string, typesModule.Credential>();
  private chains = new Map<string, Promise<unknown>>();

  private enqueue<T>(
    providerId: string,
    task: () => Promise<T>,
    options?: typesModule.AuthOperationOptions,
  ): Promise<T> {
    const signal = operationSignal(options?.signal);
    const queued = credentialStoreModule.runAfterPrevious({
      chains: this.chains,
      key: providerId,
      task: Effect.gen(function* () {
        signal.throwIfAborted();
        return yield* Effect.promise(() => task());
      }),
    });
    return raceWithAbortSignal(queued, signal);
  }

  read(
    providerId: string,
    options?: typesModule.AuthOperationOptions,
  ): Promise<typesModule.Credential | undefined> {
    try {
      options?.signal?.throwIfAborted();
      return Promise.resolve(this.credentials.get(providerId));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  list(options?: typesModule.AuthOperationOptions): Promise<readonly typesModule.CredentialInfo[]> {
    try {
      options?.signal?.throwIfAborted();
      return Promise.resolve(
        [...this.credentials].map(([providerId, credential]) => ({
          providerId,
          type: credential.type,
        })),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  modify(
    providerId: string,
    fn: (
      current: typesModule.Credential | undefined,
    ) => Promise<typesModule.Credential | undefined>,
    options?: typesModule.AuthOperationOptions,
  ): Promise<typesModule.Credential | undefined> {
    return this.enqueue(
      providerId,
      () => {
        const credentials = this.credentials;
        return Effect.runPromise(
          Effect.gen(function* () {
            const current = credentials.get(providerId);
            const next = yield* Effect.promise(() => fn(current));
            options?.signal?.throwIfAborted();
            if (next !== undefined) credentials.set(providerId, next);
            return next ?? current;
          }),
        );
      },
      options,
    );
  }

  delete(providerId: string, options?: typesModule.AuthOperationOptions): Promise<void> {
    return this.enqueue(
      providerId,
      () => {
        this.credentials.delete(providerId);
        return Promise.resolve();
      },
      options,
    );
  }
}
