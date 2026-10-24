import { Schema } from "effect";

export default class SessionFailed extends Schema.TaggedError<
  SessionFailed,
  { readonly brand: unique symbol }
>()("SessionFailed", { cause: Schema.Unknown, message: Schema.String }) {
  static create(cause: unknown): SessionFailed {
    return SessionFailed.make({
      cause,
      message: "Session failed after a storage error; close and reopen it",
    });
  }
}
