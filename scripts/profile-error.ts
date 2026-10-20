import { Data } from "effect";

export default class ProfileError extends Data.TaggedError("ProfileError")<{
  readonly message: string;
}> {}
