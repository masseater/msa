import * as Data from "effect/Data";

export class LaunchError extends Data.TaggedError("LaunchError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
