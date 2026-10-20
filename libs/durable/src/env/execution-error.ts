import { Data } from "effect";

import type executionErrorTypes from "./execution-error.types.ts";

export default class ExecutionError extends Data.TaggedError("ExecutionError")<{
  readonly code: executionErrorTypes.ExecutionErrorCode;
  readonly message: string;
  readonly cause?: Error;
}> {
  declare spillPath?: string;

  constructor(code: executionErrorTypes.ExecutionErrorCode, message: string, cause?: Error) {
    super({ code, message, ...(cause === undefined ? {} : { cause }) });
  }
}
