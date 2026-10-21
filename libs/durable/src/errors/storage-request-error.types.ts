import type StorageRequestErrorClass from "./storage-request-error.ts";

declare namespace storageRequestErrorTypes {
  type StorageRequestError = StorageRequestErrorClass;
}

export type { storageRequestErrorTypes as default };
