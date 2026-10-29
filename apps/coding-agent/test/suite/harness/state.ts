import type agentSessionTypes from "../../../src/core/agent-session.types.ts";
import InMemoryAuthStorageBackend from "../../../src/core/in-memory-auth-storage-backend.ts";
import SessionManager from "../../../src/core/session-manager.ts";
import type sessionManagerTypes from "../../../src/core/session-manager.types.ts";
import SettingsManager from "../../../src/core/settings-manager.ts";
import type settingsManagerTypes from "../../../src/core/settings-manager.types.ts";
import McpOAuthCredentialStore from "../../../src/extensions/mcp/mcp-oauth-credential-store.ts";

function createSessionManager(
  sessionManager: sessionManagerTypes.SessionManager | undefined,
): sessionManagerTypes.SessionManager {
  return sessionManager ?? SessionManager.inMemory();
}

function createSettingsManager(
  settings: Partial<settingsManagerTypes.Settings> | undefined,
): settingsManagerTypes.SettingsManager {
  return SettingsManager.inMemory({ memory: { recall: { enabled: false } }, ...settings });
}

function createMemoryConnection(
  memoryConnection: agentSessionTypes.AgentSessionConfig["memoryConnection"],
): NonNullable<agentSessionTypes.AgentSessionConfig["memoryConnection"]> {
  return (
    memoryConnection ?? {
      credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
    }
  );
}

const state = {
  createMemoryConnection,
  createSessionManager,
  createSettingsManager,
};

export default state;
