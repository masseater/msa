import { Schema } from "effect";

export default class ForeignError extends Schema.TaggedError<
  ForeignError,
  { readonly brand: unique symbol }
>()("ForeignError", { cause: Schema.Unknown, message: Schema.String }) {}
