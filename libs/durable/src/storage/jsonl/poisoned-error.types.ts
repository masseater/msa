import type JsonlStoragePoisonedErrorClass from "./poisoned-error.ts";

declare namespace poisonedErrorTypes {
  type JsonlStoragePoisonedError = JsonlStoragePoisonedErrorClass;
}

export type { poisonedErrorTypes as default };
