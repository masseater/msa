import { Schema } from "effect";

export default class Undecided extends Schema.TaggedError<
  Undecided,
  { readonly brand: unique symbol }
>()("Undecided", { reason: Schema.String }) {}
