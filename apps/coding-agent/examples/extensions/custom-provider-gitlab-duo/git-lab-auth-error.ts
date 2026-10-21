import { Data } from "effect";

export default class GitLabAuthError extends Data.TaggedError("GitLabAuthError")<{
  readonly message: string;
}> {}
