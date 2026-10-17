import { Data } from "effect";

export class MissingVerifierError extends Data.TaggedError("MissingVerifierError")<{
  readonly message: string;
}> {}
