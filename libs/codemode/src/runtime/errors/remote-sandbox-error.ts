import * as Data from "effect/Data";

export class RemoteSandboxError extends Data.TaggedError("RemoteSandboxError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
