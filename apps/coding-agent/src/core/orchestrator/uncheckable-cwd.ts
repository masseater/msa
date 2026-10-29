import { Schema } from "effect";

export default class UncheckableCwd extends Schema.TaggedError<
  UncheckableCwd,
  { readonly brand: unique symbol }
>()("UncheckableCwd", { message: Schema.String }) {}
