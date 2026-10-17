import type { McpOAuthState, McpOAuthStateStore } from "./provider-types.ts";

export class MemoryOAuthStateStore implements McpOAuthStateStore {
  private value: McpOAuthState | undefined;

  load(): McpOAuthState | undefined {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }

  save(state: McpOAuthState): void {
    this.value = structuredClone(state);
  }
}
