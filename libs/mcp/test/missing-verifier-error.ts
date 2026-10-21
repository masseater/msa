import { Data } from "effect";

class MissingVerifierError extends Data.TaggedError("MissingVerifierError")<{
  readonly message: string;
}> {}

export default MissingVerifierError;
