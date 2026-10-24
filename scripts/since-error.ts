import { Schema } from "effect";

export default class SinceError extends Schema.TaggedError<
  SinceError,
  { readonly brand: unique symbol }
>()("SinceError", { message: Schema.String }) {}
