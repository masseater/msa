import { Schema } from "effect";

import type executionErrorTypes from "./execution-error.types.ts";

export default class ExecutionError extends Schema.TaggedError<
  ExecutionError,
  { readonly brand: unique symbol }
>()("ExecutionError", {
  cause: Schema.optionalKey(Schema.instanceOf(Error)),
  code: Schema.Literals([
    "aborted",
    "timeout",
    "shell_unavailable",
    "spawn_error",
    "callback_error",
    "unknown",
  ]),
  message: Schema.String,
}) {
  declare spillPath?: string;

  static create(
    code: executionErrorTypes.ExecutionErrorCode,
    message: string,
    cause?: Error,
  ): ExecutionError {
    return ExecutionError.make({ code, message, ...(cause === undefined ? {} : { cause }) });
  }
}
