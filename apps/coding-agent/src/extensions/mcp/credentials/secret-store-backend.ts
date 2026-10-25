import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import type authStorageTypes from "../../../core/auth-storage.types.ts";
import awaitingModule from "../../../core/awaiting.ts";
import mcpSignInStorage from "../../../core/mcp-sign-in-storage.ts";
import platform from "../../../core/platform/index.ts";
import mcpRefreshLock from "../mcp-refresh-lock.ts";
import credentialHelperConfig from "./credential-helper-config.ts";
import secretStores from "./secret-stores.ts";
import type secretStoresTypes from "./secret-stores.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { join } = platform;
const { markSignInsNotSaved } = mcpSignInStorage;
const { exists, readText, remove } = platform.files;
const { memoryOnlyNotice, readCredentialHelper } = credentialHelperConfig;
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

const MCP_NAMESPACE_PREFIX = "mcp__";

const serverOf = (key: string): string => {
  const separator = key.indexOf("|");
  if (separator === -1) return key;
  const namespace = key.slice(0, separator);
  return namespace.startsWith(MCP_NAMESPACE_PREFIX)
    ? namespace.slice(MCP_NAMESPACE_PREFIX.length)
    : namespace;
};

const reasonOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).trim().replace(/[.\s]+$/u, "");

function writeVerified(store: SecretStore, value: string): Promise<void> {
  return store
    .write(value)
    .then(() => store.read())
    .then((stored) => {
      if (stored?.trim() !== value.trim())
        throw new Error(`${store.description} did not keep what was written`);
      return undefined;
    });
}

export default class SecretStoreAuthBackend implements authStorageTypes.AuthStorageBackend {
  private readonly options: Options;
  private resolved: Promise<void> | undefined;
  private active: SecretStore = memoryStore(undefined);
  private fromHelper = false;
  private legacyDeleted = false;
  private legacyServers: readonly string[] = [];
  private noticeDelivered = false;
  private settled = false;
  private readonly listeners = new Set<(notice: string) => void>();
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

  get memoryOnlyNotice(): string | undefined {
    return this.fallbackReason === undefined
      ? undefined
      : memoryOnlyNotice({
          configPath: this.configPath,
          deleted: this.legacyDeleted
            ? { path: this.legacyPath, servers: this.legacyServers }
            : undefined,
          reason: this.fallbackReason,
        });
  }

  onMemoryOnly(listener: (notice: string) => void): () => void {
    this.listeners.add(listener);
    this.deliverNotice();
    return () => this.listeners.delete(listener);
  }

  private deliverNotice(): void {
    const notice = this.memoryOnlyNotice;
    if (notice === undefined) return;
    markSignInsNotSaved(this.options.agentDir, notice);
    if (this.noticeDelivered || this.listeners.size === 0) return;
    this.noticeDelivered = true;
    for (const listener of this.listeners) listener(notice);
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
    return writeVerified(store, value).catch((error: unknown) => {
      if (this.fromHelper || !store.persistent) throw error;
      this.fallBack(reasonOf(error), value);
      if (this.settled) this.deliverNotice();
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
        if (legacy !== undefined) {
          const legacyStates = parseStates(legacy);
          this.legacyServers = [...new Set(Object.keys(legacyStates).map(serverOf))];
          const merged = { ...legacyStates, ...parseStates(current) };
          yield* awaited(this.write(this.active, `${JSON.stringify(merged, null, 2)}\n`));
          yield* awaited(remove({ force: true, path: this.legacyPath }));
          this.legacyDeleted = !this.active.persistent;
        }
        this.settled = true;
        this.deliverNotice();
      }, this),
    );
  }
}
