import type providerTypesModule from "./provider-types.ts";

export default class MemoryOAuthStateStore implements providerTypesModule.McpOAuthStateStore {
  private value: providerTypesModule.McpOAuthState | undefined;

  load(): providerTypesModule.McpOAuthState | undefined {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }

  save(state: providerTypesModule.McpOAuthState): void {
    this.value = structuredClone(state);
  }
}
