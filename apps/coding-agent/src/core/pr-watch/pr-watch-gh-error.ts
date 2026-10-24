import { Schema } from "effect";

export default class PrWatchGhError extends Schema.TaggedError<
  PrWatchGhError,
  { readonly brand: unique symbol }
>()("PrWatchGhError", {
  kind: Schema.Literals(["missing", "auth", "not-found", "rate-limit", "other"]),
  message: Schema.String,
}) {}
