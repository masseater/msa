import { Schema } from "effect";

import diagnosticsModule from "./diagnostics.ts";
import type modelsErrorTypes from "./models-error.types.ts";

const { formatThrownValue } = diagnosticsModule;

const withCauseDetail = (message: string, cause: unknown): string => {
  if (cause === undefined || cause === null) return message;
  const detail = formatThrownValue(cause).trim();
  if (detail === "" || message.includes(detail)) return message;
  return `${message}: ${detail}`;
};

export default class ModelsError extends Schema.TaggedError<
  ModelsError,
  { readonly brand: unique symbol }
>()("ModelsError", {
  cause: Schema.optionalKey(Schema.Unknown),
  code: Schema.Literals([
    "model_source",
    "model_validation",
    "provider",
    "stream",
    "auth",
    "oauth",
  ]),
  message: Schema.String,
}) {
  static create(
    code: modelsErrorTypes.ModelsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ): ModelsError {
    return ModelsError.make({
      code,
      message: withCauseDetail(message, options?.cause),
      ...(options === undefined || !("cause" in options) ? {} : { cause: options.cause }),
    });
  }
}
