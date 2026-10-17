import { Effect } from "effect";

import { operationSignal, raceWithAbortSignal } from "../utils/abort.ts";
import { runAfterPrevious } from "../utils/serial-chain.ts";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "./types.ts";

export class InMemoryCredentialStore implements CredentialStore {
  private credentials = new Map<string, Credential>();
  private chains = new Map<string, Promise<unknown>>();

  private enqueue<T>(
    providerId: string,
    task: () => Promise<T>,
    options?: AuthOperationOptions,
  ): Promise<T> {
    const signal = operationSignal(options?.signal);
    const queued = runAfterPrevious({
      chains: this.chains,
      key: providerId,
      task: Effect.gen(function* () {
        signal.throwIfAborted();
        return yield* Effect.promise(() => task());
      }),
    });
    return raceWithAbortSignal(queued, signal);
  }

  read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    try {
      options?.signal?.throwIfAborted();
      return Promise.resolve(this.credentials.get(providerId));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
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
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
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

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
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
