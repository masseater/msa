import { Data } from "effect";

export default class TicTacToeError extends Data.TaggedError("TicTacToeError")<{
  readonly message: string;
}> {}
