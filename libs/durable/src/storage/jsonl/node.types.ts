import type storageTypes from "./storage.types.ts";

declare namespace nodeTypes {
  type JsonlStorageOptions = storageTypes.JsonlStorageOptions;

  type JsonlStorage = storageTypes.JsonlStorage;
}

export type { nodeTypes as default };
