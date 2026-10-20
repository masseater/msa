import McpOAuthProvider from "./mcp-o-auth-provider.ts";
import MemoryOAuthStateStore from "./memory-store.ts";

const provider = {
  McpOAuthProvider,
  MemoryOAuthStateStore: MemoryOAuthStateStore,
};

export default provider;
