import type ExecutionErrorClass from "./execution-error.ts";

declare namespace executionErrorTypes {
  type ExecutionErrorCode =
    | "aborted"
    | "timeout"
    | "shell_unavailable"
    | "spawn_error"
    | "callback_error"
    | "unknown";

  type ExecutionError = ExecutionErrorClass;
}

export type { executionErrorTypes as default };
