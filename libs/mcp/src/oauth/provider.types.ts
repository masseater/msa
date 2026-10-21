import type memoryStoreTypes from "./memory-store.types.ts";
import type providerTypesModule from "./provider-types.ts";
import type provider from "./provider.ts";

declare namespace providerTypes {
  type McpOAuthProviderOptions = providerTypesModule.McpOAuthProviderOptions;

  type McpOAuthState = providerTypesModule.McpOAuthState;

  type McpOAuthStateStore = providerTypesModule.McpOAuthStateStore;

  type MemoryOAuthStateStore = memoryStoreTypes.MemoryOAuthStateStore;

  type McpOAuthProvider = (typeof provider.McpOAuthProvider)["prototype"];
}

export type { providerTypes as default };
