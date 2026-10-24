import { Schema } from "effect";

export default class TicTacToeError extends Schema.TaggedError<
  TicTacToeError,
  { readonly brand: unique symbol }
>()("TicTacToeError", { message: Schema.String }) {}
