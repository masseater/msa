import { Schema } from "effect";

export default class PodmanError extends Schema.TaggedError<
  PodmanError,
  { readonly brand: unique symbol }
>()("PodmanError", { message: Schema.String }) {}
