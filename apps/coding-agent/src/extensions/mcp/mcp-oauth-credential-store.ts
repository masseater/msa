import type oauthTypes from "@msa/mcp/oauth.types";

import config from "../../config.ts";
import type authStorageTypes from "../../core/auth-storage.types.ts";
import mcpServers from "../../core/mcp-servers.ts";
import SecretStoreAuthBackend from "./credentials/secret-store-backend.ts";
import mcpRefreshLock from "./mcp-refresh-lock.ts";
import type oauthTypesNs from "./oauth.types.ts";

const { mcpNamespace } = mcpServers;
const { getAgentDir } = config;
const { withRefreshLock } = mcpRefreshLock;
type StoredStates = Map<string, oauthTypes.McpOAuthState>;
function parseStates(content: string | undefined): StoredStates {
  if (content === undefined || content.trim() === "") return new Map();
  const parsed: unknown = JSON.parse(content);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? new Map(Object.entries(parsed as Record<string, oauthTypes.McpOAuthState>))
    : new Map();
}
function serializeStates(states: StoredStates): string {
  return `${JSON.stringify(Object.fromEntries(states), null, 2)}\n`;
}
function storeKeys(name: string, serverUrl: string): { key: string; legacyKey: string } {
  const legacyKey = String(new URL(serverUrl));
  return { key: `${mcpNamespace(name)}|${legacyKey}`, legacyKey };
}
export default class McpOAuthCredentialStore {
  private readonly backend: authStorageTypes.AuthStorageBackend;

  private readonly lockDir: string | undefined;

  constructor(backend?: authStorageTypes.AuthStorageBackend, lockDir?: string) {
    this.backend = backend ?? new SecretStoreAuthBackend({ agentDir: getAgentDir() });
    this.lockDir = backend === undefined ? getAgentDir() : lockDir;
  }

  persistenceNote(): Promise<string | undefined> {
    const { backend } = this;
    if (!(backend instanceof SecretStoreAuthBackend)) return Promise.resolve(undefined);
    return backend.store().then(() => backend.memoryOnlyNotice);
  }

  onMemoryOnly(listener: (notice: string) => void): () => void {
    const { backend } = this;
    return backend instanceof SecretStoreAuthBackend ? backend.onMemoryOnly(listener) : () => {};
  }

  forServer(name: string, serverUrl: string): oauthTypesNs.McpOAuthServerStore {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return {
      load: () =>
        this.backend.withLockAsync((current) => {
          const states = parseStates(current);
          const legacy = states.get(legacyKey);
          if (states.get(key) !== undefined || legacy === undefined)
            return Promise.resolve({ result: states.get(key) });
          states.set(key, legacy);
          states.delete(legacyKey);
          return Promise.resolve({ next: serializeStates(states), result: legacy });
        }),
      save: (state) =>
        this.write((states) => {
          states.set(key, state);
        }),
      withRefreshLock: (fn) => withRefreshLock(this.lockDir, key, fn),
    };
  }

  tokens(name: string, serverUrl: string): Promise<oauthTypes.McpOAuthState["tokens"]> {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return this.backend
      .withLockAsync((current) => Promise.resolve({ result: parseStates(current) }))
      .then((states) => (states.get(key) ?? states.get(legacyKey))?.tokens);
  }

  remove(name: string, serverUrl: string): Promise<boolean> {
    const { key, legacyKey } = storeKeys(name, serverUrl);
    return this.backend.withLockAsync((current) => {
      const states = parseStates(current);
      const stored = states.has(key) ? key : states.has(legacyKey) ? legacyKey : undefined;
      if (stored === undefined || stored === "") return Promise.resolve({ result: false });
      states.delete(stored);
      return Promise.resolve({ next: serializeStates(states), result: true });
    });
  }

  private write(update: (states: StoredStates) => void): Promise<void> {
    return this.backend.withLockAsync((current) => {
      const states = parseStates(current);
      update(states);
      return Promise.resolve({ next: serializeStates(states), result: undefined });
    });
  }
}
