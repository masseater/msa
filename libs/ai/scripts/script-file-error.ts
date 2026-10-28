import { Schema } from "effect";

class ScriptFileError extends Schema.TaggedError<
  ScriptFileError,
  { readonly brand: unique symbol }
>()("ScriptFileError", { message: Schema.String }) {}

export default ScriptFileError;
