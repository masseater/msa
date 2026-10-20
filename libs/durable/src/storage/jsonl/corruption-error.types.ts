import type JsonlCorruptionErrorClass from "./corruption-error.ts";

declare namespace corruptionErrorTypes {
  type JsonlCorruptionError = JsonlCorruptionErrorClass;
}

export type { corruptionErrorTypes as default };
