import { Data } from "effect";

export default class OrchestratorError extends Data.TaggedError("OrchestratorError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
