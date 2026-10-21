import { Data } from "effect";

export default class AnthropicAuthError extends Data.TaggedError("AnthropicAuthError")<{
  readonly message: string;
}> {}
