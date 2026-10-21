import type oauthTypes from "@msa/mcp/oauth.types";

import config from "../../config.ts";
import type authStorageTypes from "../../core/auth-storage.types.ts";
import FileAuthStorageBackend from "../../core/file-auth-storage-backend.ts";
import mcpServers from "../../core/mcp-servers.ts";
import platform from "../../core/platform/index.ts";
import mcpRefreshLock from "./mcp-refresh-lock.ts";
import type oauthTypesNs from "./oauth.types.ts";

const { mcpNamespace } = mcpServers;
const { join } = platform;
const { getAgentDir } = config;
const { withRefreshLock } = mcpRefreshLock;
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
      withRefreshLock: (fn) => withRefreshLock(this.lockDir, key, fn),
    };
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
