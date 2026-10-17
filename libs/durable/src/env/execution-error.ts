import { Data } from "effect";

export type ExecutionErrorCode =
  | "aborted"
  | "timeout"
  | "shell_unavailable"
  | "spawn_error"
  | "callback_error"
  | "unknown";

export class ExecutionError extends Data.TaggedError("ExecutionError")<{
  readonly code: ExecutionErrorCode;
  readonly message: string;
  readonly cause?: Error;
}> {
  declare spillPath?: string;

  constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
    super({ code, message, ...(cause === undefined ? {} : { cause }) });
  }
}
