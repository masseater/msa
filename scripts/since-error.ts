import { Data } from "effect";

export default class SinceError extends Data.TaggedError("SinceError")<{
  readonly message: string;
}> {}
