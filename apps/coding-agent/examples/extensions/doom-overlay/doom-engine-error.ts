import { Schema } from "effect";

export default class DoomEngineError extends Schema.TaggedError<
  DoomEngineError,
  { readonly brand: unique symbol }
>()("DoomEngineError", { message: Schema.String }) {}
