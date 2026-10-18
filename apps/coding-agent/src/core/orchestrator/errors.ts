import { Data } from "effect";

export class OrchestratorError extends Data.TaggedError("OrchestratorError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function orchestratorError(error: unknown): OrchestratorError {
  return new OrchestratorError({
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}
