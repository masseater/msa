import { Schema } from "effect";

export default class SshError extends Schema.TaggedError<
  SshError,
  { readonly brand: unique symbol }
>()("SshError", { message: Schema.String }) {}
