import { Schema } from "effect";

export default class RetryDelayExceededError extends Schema.TaggedError<
  RetryDelayExceededError,
  { readonly brand: unique symbol }
>()("RetryDelayExceededError", { message: Schema.String }) {}
