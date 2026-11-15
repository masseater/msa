import { Schema } from "effect";

export default class OllamaProbeFailed extends Schema.TaggedError<
  OllamaProbeFailed,
  { readonly brand: unique symbol }
>()("OllamaProbeFailed", { cause: Schema.Unknown }) {}
