import { Schema } from "effect";

export default class ScriptOutputError extends Schema.TaggedError<
  ScriptOutputError,
  { readonly brand: unique symbol }
>()("ScriptOutputError", { message: Schema.String }) {}
