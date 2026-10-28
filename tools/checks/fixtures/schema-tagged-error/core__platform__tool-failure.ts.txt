import { Schema } from "effect";

export default class ToolFailure extends Schema.TaggedError<
  ToolFailure,
  { readonly brand: unique symbol }
>()("ToolFailure", { cause: Schema.optionalKey(Schema.Unknown), message: Schema.String }) {}
