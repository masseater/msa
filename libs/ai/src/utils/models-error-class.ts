import { Data } from "effect";

import diagnosticsModule from "./diagnostics.ts";
import type modelsErrorTypes from "./models-error.types.ts";

const { formatThrownValue } = diagnosticsModule;

const withCauseDetail = (message: string, cause: unknown): string => {
  if (cause === undefined || cause === null) return message;
  const detail = formatThrownValue(cause).trim();
  if (detail === "" || message.includes(detail)) return message;
  return `${message}: ${detail}`;
};

export default class ModelsError extends Data.TaggedError("ModelsError")<{
  readonly code: modelsErrorTypes.ModelsErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}> {
  constructor(
    code: modelsErrorTypes.ModelsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super({
      code,
      message: withCauseDetail(message, options?.cause),
      ...(options === undefined || !("cause" in options) ? {} : { cause: options.cause }),
    });
  }
}
