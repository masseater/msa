import { Schema } from "effect";

export default class LlamaCallFailed extends Schema.TaggedError<
  LlamaCallFailed,
  { readonly brand: unique symbol }
>()("LlamaCallFailed", { cause: Schema.Unknown }) {}
