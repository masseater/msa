import { Schema } from "effect";

class MissingVerifierError extends Schema.TaggedError<
  MissingVerifierError,
  { readonly brand: unique symbol }
>()("MissingVerifierError", { message: Schema.String }) {}

export default MissingVerifierError;
