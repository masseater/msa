import { Data } from "effect";

export default class RetryDelayExceededError extends Data.TaggedError("RetryDelayExceededError")<{
  readonly message: string;
}> {}
