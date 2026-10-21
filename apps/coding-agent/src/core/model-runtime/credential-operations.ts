import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import abortModule from "../../utils/abort.ts";
import awaitingModule from "../awaiting.ts";
import CredentialSynchronizationError from "../credential-synchronization-error.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import platform from "../platform.ts";
import type runtimeCredentialsTypes from "../runtime-credentials.types.ts";
import type ModelAvailability from "./model-availability.ts";
import type ProviderCatalog from "./provider-catalog.ts";

const { awaited, awaiting, awaitingWith, performed } = awaitingModule;
const { makeLatch } = platform;
const { operationSignal, raceWithAbortSignal } = abortModule;

export default class CredentialOperations {
  private readonly models: aiTypes.MutableModels;
  private readonly credentials: runtimeCredentialsTypes.RuntimeCredentials;
  private readonly catalog: ProviderCatalog;
  private readonly availability: ModelAvailability;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    models: aiTypes.MutableModels,
    credentials: runtimeCredentialsTypes.RuntimeCredentials,
    catalog: ProviderCatalog,
    availability: ModelAvailability,
  ) {
    this.models = models;
    this.credentials = credentials;
    this.catalog = catalog;
    this.availability = availability;
  }

  setRuntimeApiKey(
    providerId: string,
    apiKey: string,
    options: aiTypes.AuthOperationOptions,
  ): Promise<void> {
    const signal = operationSignal(options.signal);
    return this.enqueue(providerId, signal, () => {
      this.credentials.setRuntimeApiKey(providerId, apiKey);
      return this.synchronize(
        providerId,
        "setRuntimeApiKey",
        { key: apiKey, type: "api_key" },
        signal,
      );
    });
  }

  removeRuntimeApiKey(providerId: string, options: aiTypes.AuthOperationOptions): Promise<void> {
    const signal = operationSignal(options.signal);
    return this.enqueue(providerId, signal, () => {
      this.credentials.removeRuntimeApiKey(providerId);
      return this.synchronize(providerId, "removeRuntimeApiKey", undefined, signal);
    });
  }

  login(
    providerId: string,
    type: aiTypes.AuthType,
    interaction: aiTypes.AuthInteraction,
    options?: aiTypes.LoginOptions,
  ): Promise<aiTypes.Credential> {
    const signal = operationSignal(interaction.signal);
    return this.enqueue(providerId, signal, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          const credential = yield* awaited(
            this.models.login(providerId, type, { ...interaction, signal }, options),
          );
          yield* awaited(this.synchronize(providerId, "login", credential, signal));
          return credential;
        }, this),
      ),
    );
  }

  logout(providerId: string, options: aiTypes.AuthOperationOptions): Promise<void> {
    const signal = operationSignal(options.signal);
    return this.enqueue(providerId, signal, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(this.models.logout(providerId, { signal }));
          yield* awaited(this.synchronize(providerId, "logout", undefined, signal));
        }, this),
      ),
    );
  }

  private enqueue<T>(providerId: string, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(providerId) ?? Promise.resolve();
    const startedLatch = makeLatch();
    const operation = Effect.runPromise(
      awaiting(function* () {
        yield* awaited(previous.catch(() => {}));
        signal.throwIfAborted();
        startedLatch.open();
        return yield* awaited(task());
      }),
    );
    const tail = operation.catch(() => {});
    this.queues.set(providerId, tail);
    void tail.then(() => {
      if (this.queues.get(providerId) === tail) this.queues.delete(providerId);
      return undefined;
    });
    return raceWithAbortSignal(startedLatch.promise, signal).then(() => operation);
  }

  private synchronize(
    providerId: string,
    operation: modelRuntimeTypes.CredentialSynchronizationOperation,
    credential: aiTypes.Credential | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          signal.throwIfAborted();
          this.catalog.recompose(providerId);
          const compositionError = this.catalog.compositionError(providerId);
          if (compositionError !== undefined && compositionError !== "")
            throw new Error(compositionError);
          const result = yield* awaited(
            this.models.refresh({ allowNetwork: false, providers: [providerId], signal }),
          );
          if (result.aborted) signal.throwIfAborted();
          const refreshError = result.errors.get(providerId);
          if (refreshError !== undefined) throw refreshError;
          this.availability.updateModels();
          yield* performed(this.availability.refreshProvider(providerId, signal));
        } catch (cause) {
          throw new CredentialSynchronizationError(providerId, operation, credential, { cause });
        }
      }, this),
    );
  }
}
