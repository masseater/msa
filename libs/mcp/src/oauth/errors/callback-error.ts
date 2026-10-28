import { Schema } from "effect";

export default class OAuthCallbackError extends Schema.TaggedError<
  OAuthCallbackError,
  { readonly brand: unique symbol }
>()("OAuthCallbackError", { message: Schema.String }) {
  static create(message: string): OAuthCallbackError {
    return OAuthCallbackError.make({ message });
  }
}
