import { Schema } from "effect";

export default class ClaudeCodeFailure extends Schema.TaggedError<
  ClaudeCodeFailure,
  { readonly brand: unique symbol }
>()("ClaudeCodeFailure", { cause: Schema.optionalKey(Schema.Unknown), message: Schema.String }) {
  static fromCause(cause: unknown): ClaudeCodeFailure {
    return ClaudeCodeFailure.make({
      cause,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
