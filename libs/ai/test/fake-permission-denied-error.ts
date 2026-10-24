import { Schema } from "effect";

class FakePermissionDeniedError extends Schema.TaggedError<
  FakePermissionDeniedError,
  { readonly brand: unique symbol }
>()("PermissionDeniedError", {
  error: Schema.Unknown,
  message: Schema.String,
  status: Schema.Finite,
}) {}

export default FakePermissionDeniedError;
