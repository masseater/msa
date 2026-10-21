import { Data } from "effect";

export default class ProcessExitError extends Data.TaggedError("ProcessExitError")<{
  readonly code?: number;
}> {}
