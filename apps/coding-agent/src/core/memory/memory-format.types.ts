import type memoryTypesTypes from "./memory-types.ts";
import type storeTypes from "./store.types.ts";

declare namespace memoryFormatTypes {
  type MemoryCommand =
    | { kind: "status" }
    | { kind: "list" }
    | { kind: "stats" }
    | { kind: "search"; query: string }
    | { kind: "forget"; id: string };

  interface MemoryStatusInput {
    settings: memoryTypesTypes.ResolvedMemorySettings;
    project: string;
    stats: storeTypes.MemoryStoreStats;
    lastEmbeddingError: string | undefined;
  }
}

export type { memoryFormatTypes as default };
