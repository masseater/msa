import { Schema } from "effect";

export default class SpawnError extends Schema.TaggedError<
  SpawnError,
  { readonly brand: unique symbol }
>()("SpawnError", { cause: Schema.Unknown, message: Schema.String }) {}
