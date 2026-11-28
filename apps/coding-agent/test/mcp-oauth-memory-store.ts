import InMemoryAuthStorageBackend from "../src/core/in-memory-auth-storage-backend.ts";
import McpOAuthCredentialStore from "../src/extensions/mcp/mcp-oauth-credential-store.ts";

interface MemoryStoreOptions {
  backend?: InMemoryAuthStorageBackend;
  lockDir?: string;
}

const memoryBackend = () => new InMemoryAuthStorageBackend();

const memoryServerStore = (serverUrl: string, options: MemoryStoreOptions = {}) =>
  new McpOAuthCredentialStore(options.backend ?? memoryBackend(), options.lockDir).forServer(
    "test",
    serverUrl,
  );

const oauthState = (serverUrl: string, accessToken: string) => ({
  serverUrl,
  tokens: { access_token: accessToken, token_type: "Bearer" },
});

const mcpOAuthMemoryStore = { memoryBackend, memoryServerStore, oauthState };

export default mcpOAuthMemoryStore;
