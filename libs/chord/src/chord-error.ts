import { Data } from "effect";

import type errorsTypes from "./errors.types.ts";

const RETRYABLE: ReadonlySet<errorsTypes.ChordErrorCode> = new Set([
  "superseded",
  "upgrade_conflict",
]);

export default class ChordError extends Data.TaggedError("ChordError")<{
  readonly code: errorsTypes.ChordErrorCode;
  readonly reason: errorsTypes.ChordErrorReason | undefined;
  readonly retryable: boolean;
  readonly details: unknown;
  readonly message: string;
  readonly cause?: unknown;
}> {
  constructor(
    code: errorsTypes.ChordErrorCode,
    message: string,
    options?: errorsTypes.ChordErrorOptions,
  ) {
    const reason = options?.reason;
    super({
      cause: options?.cause,
      code,
      details: options?.details,
      message: `${code}${reason === undefined || reason === "" ? "" : `/${reason}`}: ${message}`,
      reason,
      retryable: RETRYABLE.has(code),
    });
  }
}
