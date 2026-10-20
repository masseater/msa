import type oauthTypes from "@msa/mcp/oauth.types";
import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import config from "../../config.ts";
import type authStorageTypes from "../../core/auth-storage.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import FileAuthStorageBackend from "../../core/file-auth-storage-backend.ts";
import mcpServers from "../../core/mcp-servers.ts";
import platformNode from "../../core/platform-node.ts";
import nodeFs from "../../utils/node-fs.ts";
import type oauthTypesNs from "./oauth.types.ts";

const { mcpNamespace } = mcpServers;
const { join, sha256Hex } = platformNode;
const { getAgentDir } = config;
const { awaited, awaitingWith } = awaitingModule;
const { makeDirectory } = nodeFs;
const REFRESH_LOCK_STALE_MS = 20_000;
const REFRESH_LOCK_WAIT_MS = 25_000;
const REFRESH_LOCK_RETRY_MS = 100;
type StoredStates = Record<string, oauthTypes.McpOAuthState>;
function parseStates(content: string | undefined): StoredStates {
  if (content === undefined || content.trim() === "") return {};
  const parsed: unknown = JSON.parse(content);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as StoredStates)
    : {};
}
function serializeStates(states: StoredStates): string {
  return `${JSON.stringify(states, null, 2)}\n`;
}
function storeKeys(name: string, serverUrl: string): { key: string; legacyKey: string } {
  const legacyKey = String(new URL(serverUrl));
  return { key: `${mcpNamespace(name)}|${legacyKey}`, legacyKey };
}
export default class McpOAuthCredentialStore {
  private readonly backend: authStorageTypes.AuthStorageBackend;

  private readonly lockDir: string | undefined;

  constructor(backend?: authStorageTypes.AuthStorageBackend, lockDir?: string) {
    this.backend = backend ?? new FileAuthStorageBackend(join(getAgentDir(), "mcp-auth.json"));
    this.lockDir = backend === undefined ? getAgentDir() : lockDir;
  }

  forServer(name: string, serverUrl: string): oauthTypesNs.McpOAuthServerStore {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return {
      load: () =>
        this.backend.withLock((current) => {
          const states = parseStates(current);
          if (states[key] !== undefined || states[legacyKey] === undefined)
            return { result: states[key] };
          states[key] = states[legacyKey];
          delete states[legacyKey];
          return { next: serializeStates(states), result: states[key] };
        }),
      save: (state) =>
        this.write((states) => {
          states[key] = state;
        }),
      withRefreshLock: (fn) => this.withRefreshLock(key, fn),
    };
  }

  private withRefreshLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.lockDir === undefined || this.lockDir === "") return yield* awaited(fn());
        const lockDir = this.lockDir;
        yield* awaited(makeDirectory({ mode: 0o700, path: lockDir }));
        const hash = sha256Hex(key).slice(0, 16);
        const release = yield* awaited(
          lockfile.lock(join(this.lockDir, `mcp-auth-refresh-${hash}`), {
            onCompromised: () => {},
            realpath: false,
            retries: {
              factor: 1,
              maxTimeout: REFRESH_LOCK_RETRY_MS,
              minTimeout: REFRESH_LOCK_RETRY_MS,
              retries: REFRESH_LOCK_WAIT_MS / REFRESH_LOCK_RETRY_MS,
            },
            stale: REFRESH_LOCK_STALE_MS,
          }),
        );
        try {
          return yield* awaited(fn());
        } finally {
          yield* awaited(release().catch(() => undefined));
        }
      }, this),
    );
  }

  tokens(name: string, serverUrl: string): oauthTypes.McpOAuthState["tokens"] {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    const states = this.backend.withLock((current) => ({ result: parseStates(current) }));
    return (states[key] ?? states[legacyKey])?.tokens;
  }

  remove(name: string, serverUrl: string): boolean {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return this.backend.withLock((current) => {
      const states = parseStates(current);
      const stored = key in states ? key : legacyKey in states ? legacyKey : undefined;
      if (stored === undefined || stored === "") return { result: false };
      delete states[stored];
      return { next: serializeStates(states), result: true };
    });
  }

  private write(update: (states: StoredStates) => void): void {
    this.backend.withLock((current) => {
      const states = parseStates(current);
      update(states);
      return { next: serializeStates(states), result: undefined };
    });
  }
}
