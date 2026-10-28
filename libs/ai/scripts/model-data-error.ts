import { Schema } from "effect";

export default class ModelDataError extends Schema.TaggedError<
  ModelDataError,
  { readonly brand: unique symbol }
>()("ModelDataError", { message: Schema.String }) {}
