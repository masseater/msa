import { Schema } from "effect";

export default class McpForeignError extends Schema.TaggedError<
  McpForeignError,
  { readonly brand: unique symbol }
>()("McpForeignError", { cause: Schema.Unknown, message: Schema.String }) {}
