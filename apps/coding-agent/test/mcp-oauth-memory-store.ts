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

const mcpOAuthMemoryStore = { memoryBackend, memoryServerStore };

export default mcpOAuthMemoryStore;
