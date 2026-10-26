import { Schema } from "effect";

export default class OrchestratorError extends Schema.TaggedError<
  OrchestratorError,
  { readonly brand: unique symbol }
>()("OrchestratorError", { cause: Schema.optionalKey(Schema.Unknown), message: Schema.String }) {}
