import type corruptionErrorTypes from "./corruption-error.types.ts";
import type poisonedErrorTypes from "./poisoned-error.types.ts";
import type storageTypes from "./storage.types.ts";

declare namespace jsonlTypes {
  type JsonlStorageOptions = storageTypes.JsonlStorageOptions;

  type JsonlCorruptionError = corruptionErrorTypes.JsonlCorruptionError;

  type JsonlStoragePoisonedError = poisonedErrorTypes.JsonlStoragePoisonedError;

  type JsonlStorage = storageTypes.JsonlStorage;
}

export type { jsonlTypes as default };
