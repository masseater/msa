import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import abortModule from "../utils/abort.ts";
import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";
const { awaited, awaitingWith } = awaitingModule;
const { raceWithAbortSignal } = abortModule;

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
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(previous.catch(() => {}));
          options?.signal?.throwIfAborted();
          const { result, next } = yield* awaited(fn(this.value));
          options?.signal?.throwIfAborted();
          if (next !== undefined) {
            this.value = next;
          }
          return result;
        }, this),
      ))();
    this.asyncChain = operation.catch(() => {});
    return raceWithAbortSignal(operation, options?.signal);
  }
}
