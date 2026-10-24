import * as Schema from "effect/Schema";

export default class RuntimeError extends Schema.TaggedError<
  RuntimeError,
  { readonly brand: unique symbol }
>()("CodemodeRuntimeError", {
  cause: Schema.optionalKey(Schema.Unknown),
  message: Schema.String,
  reason: Schema.Literals(["bridge", "launch", "tool", "remote"]),
}) {}
