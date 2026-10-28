import { Schema } from "effect";

export default class WorkerUnavailable extends Schema.TaggedError<
  WorkerUnavailable,
  { readonly brand: unique symbol }
>()("WorkerUnavailable", { cause: Schema.Unknown, message: Schema.String }) {}
