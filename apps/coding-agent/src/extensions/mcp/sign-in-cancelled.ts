import { Schema } from "effect";

export default class McpSignInCancelledError extends Schema.TaggedError<
  McpSignInCancelledError,
  { readonly brand: unique symbol }
>()("McpSignInCancelledError", { message: Schema.String }) {
  static create(): McpSignInCancelledError {
    return McpSignInCancelledError.make({ message: "Sign-in cancelled" });
  }
}
