import { Data } from "effect";

export class ForeignError extends Data.TaggedError("ForeignError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}
