import { Schema } from "effect";

export default class GondolinAborted extends Schema.TaggedError<
  GondolinAborted,
  { readonly brand: unique symbol }
>()("GondolinAborted", { message: Schema.String }) {}
