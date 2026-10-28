import { Schema } from "effect";

import CHORD_ERROR_CODES from "./chord-error-codes.ts";
import type errorsTypes from "./errors.types.ts";

const RETRYABLE: ReadonlySet<errorsTypes.ChordErrorCode> = new Set([
  "superseded",
  "upgrade_conflict",
]);

export default class ChordError extends Schema.TaggedError<
  ChordError,
  { readonly brand: unique symbol }
>()("ChordError", {
  cause: Schema.optionalKey(Schema.Unknown),
  code: Schema.Literals(CHORD_ERROR_CODES),
  details: Schema.Unknown,
  message: Schema.String,
  reason: Schema.UndefinedOr(Schema.String),
  retryable: Schema.Boolean,
}) {
  static create(
    code: errorsTypes.ChordErrorCode,
    message: string,
    options?: errorsTypes.ChordErrorOptions,
  ): ChordError {
    const reason = options?.reason;
    return ChordError.make({
      cause: options?.cause,
      code,
      details: options?.details,
      message: `${code}${reason === undefined || reason === "" ? "" : `/${reason}`}: ${message}`,
      reason,
      retryable: RETRYABLE.has(code),
    });
  }
}
