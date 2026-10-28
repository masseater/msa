import { Schema } from "effect";

export default class IndexLocked extends Schema.TaggedError<
  IndexLocked,
  { readonly brand: unique symbol }
>()("IndexLocked", { cause: Schema.Unknown, message: Schema.String }) {}
