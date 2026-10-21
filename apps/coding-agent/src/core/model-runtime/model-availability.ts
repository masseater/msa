import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import abortModule from "../../utils/abort.ts";
import errorsModule from "../../utils/errors.ts";
import awaitingModule from "../awaiting.ts";
import type runtimeCredentialsTypes from "../runtime-credentials.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { operationSignal } = abortModule;

type Model = aiTypes.Model<aiTypes.Api>;

interface AvailabilitySnapshot {
  all: readonly Model[];
  available: readonly Model[];
  configuredProviders: ReadonlySet<string>;
  storedProviders: ReadonlySet<string>;
  auth: ReadonlyMap<string, aiTypes.AuthCheck | undefined>;
}

const modelKey = (model: Model) => `${model.provider}\0${model.id}`;

export default class ModelAvailability {
  private readonly models: aiTypes.MutableModels;
  private readonly credentials: runtimeCredentialsTypes.RuntimeCredentials;
  private snapshot: AvailabilitySnapshot = {
    all: [],
    auth: new Map(),
    available: [],
    configuredProviders: new Set(),
    storedProviders: new Set(),
  };
  private refreshSeq = 0;
  private latestRefresh: { seq: number; pass: Promise<void> } | undefined;
  private errorSeq = 0;
  private readonly providerSeq = new Map<string, number>();
  private error: string | undefined;

  constructor(
    models: aiTypes.MutableModels,
    credentials: runtimeCredentialsTypes.RuntimeCredentials,
  ) {
    this.models = models;
    this.credentials = credentials;
  }

  get available(): readonly Model[] {
    return this.snapshot.available;
  }

  errors(): string[] {
    return this.error !== undefined && this.error !== ""
      ? [`Availability refresh: ${this.error}`]
      : [];
  }

  authCheck(providerId: string): aiTypes.AuthCheck | undefined {
    return this.snapshot.auth.get(providerId);
  }

  hasConfiguredAuth(providerId: string): boolean {
    return this.snapshot.configuredProviders.has(providerId);
  }

  isStored(providerId: string): boolean {
    return this.snapshot.storedProviders.has(providerId);
  }

  updateModels(): void {
    const all = [...this.models.getModels()];
    this.snapshot = {
      ...this.snapshot,
      all,
      available: all.filter((model) => this.snapshot.configuredProviders.has(model.provider)),
    };
  }

  markConfigured(providerId: string, check: aiTypes.AuthCheck): void {
    const configuredProviders = new Set(this.snapshot.configuredProviders).add(providerId);
    const auth = new Map(this.snapshot.auth);
    if (auth.get(providerId) === undefined) auth.set(providerId, check);
    this.snapshot = {
      ...this.snapshot,
      auth,
      available: this.snapshot.all.filter((model) => configuredProviders.has(model.provider)),
      configuredProviders,
    };
  }

  markVirtualConfigured(providerId: string): void {
    if (this.snapshot.configuredProviders.has(providerId)) return;
    const auth = new Map(this.snapshot.auth).set(providerId, {
      source: "virtual",
      type: "api_key",
    });
    const configuredProviders = new Set(this.snapshot.configuredProviders).add(providerId);
    this.snapshot = { ...this.snapshot, auth, configuredProviders };
  }

  getAvailable(
    providerId: string | undefined,
    options: aiTypes.AuthOperationOptions | undefined,
  ): Promise<readonly Model[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (providerId === undefined || providerId === "") {
          yield* awaited(this.refreshAll(options?.signal));
          return this.snapshot.available;
        }
        const errorSeq = ++this.errorSeq;
        try {
          const available = yield* awaited(this.models.getAvailable(providerId, options));
          if (errorSeq === this.errorSeq) this.error = undefined;
          return available;
        } catch (error) {
          if (errorSeq === this.errorSeq && options?.signal?.aborted !== true) {
            this.error = toErrorMessage(error);
          }
          throw error;
        }
      }, this),
    );
  }

  refreshAll(signal?: AbortSignal): Promise<void> {
    const seq = ++this.refreshSeq;
    for (const [providerId, providerSeq] of this.providerSeq) {
      this.providerSeq.set(providerId, providerSeq + 1);
    }
    const errorSeq = ++this.errorSeq;
    const effectiveSignal = operationSignal(signal);
    const pass = Effect.runPromise(this.runRefresh(seq, errorSeq, effectiveSignal)).catch(
      (error) => {
        if (errorSeq === this.errorSeq && !effectiveSignal.aborted) {
          this.error = toErrorMessage(error);
        }
        throw error;
      },
    );
    this.latestRefresh = { pass, seq };
    return pass;
  }

  refreshProvider(providerId: string, signal: AbortSignal): Effect.Effect<void> {
    return awaitingWith(function* () {
      ++this.refreshSeq;
      const providerSeq = (this.providerSeq.get(providerId) ?? 0) + 1;
      this.providerSeq.set(providerId, providerSeq);
      const errorSeq = ++this.errorSeq;
      try {
        const [available, auth, credential] = yield* awaited(
          Promise.all([
            this.models.getAvailable(providerId, { signal }),
            this.models.checkAuth(providerId, { signal }),
            this.credentials.read(providerId, { signal }),
          ]),
        );
        signal.throwIfAborted();
        if (this.providerSeq.get(providerId) !== providerSeq) return;
        this.applyProvider(providerId, { auth, available, stored: credential !== undefined });
        if (errorSeq === this.errorSeq) this.error = undefined;
      } catch (error) {
        if (
          this.providerSeq.get(providerId) === providerSeq &&
          errorSeq === this.errorSeq &&
          !signal.aborted
        ) {
          this.error = toErrorMessage(error);
        }
        throw error;
      }
    }, this);
  }

  private applyProvider(
    providerId: string,
    result: {
      auth: aiTypes.AuthCheck | undefined;
      available: readonly Model[];
      stored: boolean;
    },
  ): void {
    const configuredProviders = new Set(this.snapshot.configuredProviders);
    const storedProviders = new Set(this.snapshot.storedProviders);
    const authByProvider = new Map(this.snapshot.auth);
    if (result.auth === undefined) {
      configuredProviders.delete(providerId);
      authByProvider.delete(providerId);
    } else {
      configuredProviders.add(providerId);
      authByProvider.set(providerId, result.auth);
    }
    if (result.stored) storedProviders.add(providerId);
    else storedProviders.delete(providerId);
    const all = [...this.models.getModels()];
    const availableById = new Map(
      [
        ...this.snapshot.available.filter((model) => model.provider !== providerId),
        ...result.available,
      ].map((model) => [modelKey(model), model]),
    );
    this.snapshot = {
      all,
      auth: authByProvider,
      available: all.flatMap((model) => availableById.get(modelKey(model)) ?? []),
      configuredProviders,
      storedProviders,
    };
  }

  private runRefresh(seq: number, errorSeq: number, signal: AbortSignal): Effect.Effect<void> {
    return awaitingWith(function* () {
      const providers = this.models.getProviders();
      const [available, checks, credentials] = yield* awaited(
        Promise.all([
          this.models.getAvailable(undefined, { signal }),
          Promise.all(
            providers.map((provider) =>
              this.models
                .checkAuth(provider.id, { signal })
                .then((check): [string, aiTypes.AuthCheck | undefined] => [provider.id, check]),
            ),
          ),
          this.credentials.list({ signal }),
        ]),
      );
      if (seq !== this.refreshSeq) {
        const latest = this.latestRefresh;
        if (latest !== undefined && latest.seq > seq) yield* awaited(latest.pass);
        return;
      }
      this.snapshot = {
        all: [...this.models.getModels()],
        auth: new Map(checks),
        available: [...available],
        configuredProviders: new Set(
          checks
            .filter((entry): entry is [string, aiTypes.AuthCheck] => entry[1] !== undefined)
            .map(([providerId]) => providerId),
        ),
        storedProviders: new Set(credentials.map((entry) => entry.providerId)),
      };
      if (errorSeq === this.errorSeq) this.error = undefined;
    }, this);
  }
}
