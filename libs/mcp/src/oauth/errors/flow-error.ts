import { Schema } from "effect";

export default class OAuthFlowError extends Schema.TaggedError<
  OAuthFlowError,
  { readonly brand: unique symbol }
>()("OAuthFlowError", { message: Schema.String }) {
  static create(message: string): OAuthFlowError {
    return OAuthFlowError.make({ message });
  }
}
