import { Schema } from "effect";

export default class CodexStreamError extends Schema.TaggedError<
  CodexStreamError,
  { readonly brand: unique symbol }
>()("CodexStreamError", {
  cause: Schema.optionalKey(Schema.Unknown),
  code: Schema.optional(Schema.String),
  kind: Schema.Literals(["api", "protocol", "callback"]),
  message: Schema.String,
  payload: Schema.optionalKey(Schema.Unknown),
}) {}
