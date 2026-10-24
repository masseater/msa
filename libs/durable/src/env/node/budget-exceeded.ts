import { Schema } from "effect";

export default class BudgetExceeded extends Schema.TaggedError<
  BudgetExceeded,
  { readonly brand: unique symbol }
>()("BudgetExceeded", { message: Schema.String }) {}
