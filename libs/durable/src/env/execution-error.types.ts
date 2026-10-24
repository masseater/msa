import type ExecutionErrorClass from "./execution-error.ts";

declare namespace executionErrorTypes {
  type ExecutionErrorCode = ExecutionErrorClass["code"];

  type ExecutionError = ExecutionErrorClass;
}

export type { executionErrorTypes as default };
