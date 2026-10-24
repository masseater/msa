import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import type authStorageTypes from "../../../core/auth-storage.types.ts";
import awaitingModule from "../../../core/awaiting.ts";
import platform from "../../../core/platform/index.ts";
import mcpRefreshLock from "../mcp-refresh-lock.ts";
import credentialHelperConfig from "./credential-helper-config.ts";
import secretStores from "./secret-stores.ts";
import type secretStoresTypes from "./secret-stores.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { join } = platform;
const { exists, readText, remove } = platform.files;
const { readCredentialHelper } = credentialHelperConfig;
const { withRefreshLock } = mcpRefreshLock;
const { credentialHelperStore, memoryStore, platformStore } = secretStores;

const LEGACY_FILE = "mcp-auth.json";
const LOCK_KEY = "mcp-oauth-store";

type SecretStore = secretStoresTypes.SecretStore;

interface Options {
  readonly agentDir: string;
  readonly defaultStore?: SecretStore | undefined;
}

const parseStates = (text: string | undefined): Record<string, unknown> => {
  if (text === undefined || text.trim() === "") return {};
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default class SecretStoreAuthBackend implements authStorageTypes.AuthStorageBackend {
  private readonly options: Options;
  private resolved: Promise<void> | undefined;
  private active: SecretStore = memoryStore(undefined);
  private fromHelper = false;
  fallbackReason: string | undefined;

  constructor(options: Options) {
    this.options = options;
  }

  get legacyPath(): string {
    return join(this.options.agentDir, LEGACY_FILE);
  }

  get configPath(): string {
    return join(this.options.agentDir, "mcp.json");
  }

  store(): Promise<SecretStore> {
    this.resolved ??= withRefreshLock(this.options.agentDir, LOCK_KEY, () => this.resolveStore());
    return this.resolved.then(() => this.active);
  }

  withLockAsync<T>(
    fn: (current: string | undefined) => Promise<authStorageTypes.LockResult<T>>,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<T> {
    return Effect.runPromise(
      awaitingWith(function* () {
        options?.signal?.throwIfAborted();
        yield* awaited(this.store());
        return yield* awaited(
          withRefreshLock(this.options.agentDir, LOCK_KEY, () =>
            Effect.runPromise(
              awaitingWith(function* () {
                options?.signal?.throwIfAborted();
                const store = this.active;
                const { result, next } = yield* awaited(fn(yield* awaited(store.read())));
                options?.signal?.throwIfAborted();
                if (next !== undefined) yield* awaited(this.write(store, next));
                return result;
              }, this),
            ),
          ),
        );
      }, this),
    );
  }

  private fallBack(reason: string, value: string | undefined): void {
    this.fallbackReason = reason;
    this.active = memoryStore(value);
  }

  private write(store: SecretStore, value: string): Promise<void> {
    return store.write(value).catch((error: unknown) => {
      if (this.fromHelper || !store.persistent) throw error;
      this.fallBack(reasonOf(error), value);
    });
  }

  private resolveStore(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const legacy = (yield* awaited(exists(this.legacyPath)))
          ? yield* awaited(readText(this.legacyPath))
          : undefined;
        const helper = yield* awaited(readCredentialHelper(this.options.agentDir));
        this.fromHelper = helper !== undefined;
        const preferred =
          helper === undefined
            ? (this.options.defaultStore ?? platformStore(process.platform, this.options.agentDir))
            : credentialHelperStore(helper);
        let current: string | undefined;
        if (preferred === undefined) {
          this.fallBack("no credential store is available on this platform", undefined);
        } else {
          try {
            current = yield* awaited(preferred.read());
            this.active = preferred;
          } catch (error) {
            if (helper !== undefined) throw error;
            this.fallBack(reasonOf(error), undefined);
          }
        }
        if (legacy === undefined) return;
        const merged = { ...parseStates(legacy), ...parseStates(current) };
        yield* awaited(this.write(this.active, `${JSON.stringify(merged, null, 2)}\n`));
        yield* awaited(remove({ force: true, path: this.legacyPath }));
      }, this),
    );
  }
}
