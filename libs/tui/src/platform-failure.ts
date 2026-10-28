import { Schema } from "effect";

export default class PlatformFailure extends Schema.TaggedError<
  PlatformFailure,
  { readonly brand: unique symbol }
>()("PlatformFailure", { cause: Schema.Unknown, operation: Schema.String }) {}
