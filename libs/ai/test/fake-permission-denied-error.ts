import { Data } from "effect";

class FakePermissionDeniedError extends Data.TaggedError("PermissionDeniedError")<{
  readonly message: string;
  readonly status: number;
  readonly error: unknown;
}> {}

export default FakePermissionDeniedError;
