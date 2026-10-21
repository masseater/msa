import type MemoryStoreClass from "./memory-store.ts";
import type storeTypesTypes from "./store-types.types.ts";

declare namespace storeTypes {
  type MemoryStore = (typeof MemoryStoreClass)["prototype"];

  type MemoryKind = storeTypesTypes.MemoryKind;

  type MemoryRecord = storeTypesTypes.MemoryRecord;

  type MemorySaveInput = storeTypesTypes.MemorySaveInput;

  type MemorySaveResult = storeTypesTypes.MemorySaveResult;

  type MemoryScope = storeTypesTypes.MemoryScope;

  type MemoryScore = storeTypesTypes.MemoryScore;

  type MemoryStoreSearchOptions = storeTypesTypes.MemoryStoreSearchOptions;

  type MemoryStoreStats = storeTypesTypes.MemoryStoreStats;
}

export type { storeTypes as default };
