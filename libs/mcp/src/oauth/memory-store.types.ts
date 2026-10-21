import type MemoryOAuthStateStoreClass from "./memory-store.ts";

declare namespace memoryStoreTypes {
  type MemoryOAuthStateStore = MemoryOAuthStateStoreClass;
}

export type { memoryStoreTypes as default };
