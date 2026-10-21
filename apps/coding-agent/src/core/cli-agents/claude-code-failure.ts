import { Data } from "effect";

export default class ClaudeCodeFailure extends Data.TaggedError("ClaudeCodeFailure")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static fromCause(cause: unknown): ClaudeCodeFailure {
    return new ClaudeCodeFailure({
      cause,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
