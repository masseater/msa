import type aiTypes from "@msa/ai/index.types";

import abortModule from "../utils/abort.ts";
import authStorageTransaction from "./auth-storage-transaction.ts";
import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";
const { awaited, promisedWith } = awaitingModule;
const { raceWithAbortSignal } = abortModule;
const { transact } = authStorageTransaction;

export default class InMemoryAuthStorageBackend implements authStorageTypes.AuthStorageBackend {
  private value: string | undefined;
  private asyncChain: Promise<unknown> = Promise.resolve();

  constructor(initial?: string) {
    this.value = initial;
  }

  withLockAsync<T>(
    fn: (current: string | undefined) => Promise<authStorageTypes.LockResult<T>>,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<T> {
    const previous = this.asyncChain;
    const operation = (() =>
      promisedWith(function* () {
        yield* awaited(previous.catch(() => {}));
        return yield* transact({
          fn,
          read: () => this.value,
          signal: options?.signal,
          write: (next) => {
            this.value = next;
          },
        });
      }, this))();
    this.asyncChain = operation.catch(() => {});
    return raceWithAbortSignal(operation, options?.signal);
  }
}
