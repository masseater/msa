import type errorsModule from "./errors.ts";

declare namespace errorsTypes {
  type ChordErrorCode = (typeof errorsModule.CHORD_ERROR_CODES)[number];

  type ChordErrorReason = string;

  interface ChordErrorOptions {
    cause?: unknown;
    details?: unknown;
    reason?: ChordErrorReason | undefined;
  }

  type ChordError = (typeof errorsModule.ChordError)["prototype"];
}

export type { errorsTypes as default };
