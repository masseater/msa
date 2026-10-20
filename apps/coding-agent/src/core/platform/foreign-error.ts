import { Data } from "effect";

export default class ForeignError extends Data.TaggedError("ForeignError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}
