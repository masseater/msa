import { Schema } from "effect";

export default class AnthropicAuthError extends Schema.TaggedError<
  AnthropicAuthError,
  { readonly brand: unique symbol }
>()("AnthropicAuthError", { message: Schema.String }) {}
