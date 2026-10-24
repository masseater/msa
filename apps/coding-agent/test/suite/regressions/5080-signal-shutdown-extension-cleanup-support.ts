import { Schema } from "effect";

export default class ProcessExitError extends Schema.TaggedError<
  ProcessExitError,
  { readonly brand: unique symbol }
>()("ProcessExitError", { code: Schema.optionalKey(Schema.Finite) }) {}
