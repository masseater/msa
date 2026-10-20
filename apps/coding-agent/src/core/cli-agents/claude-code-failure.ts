import { Data } from "effect";

export default class ClaudeCodeFailure extends Data.TaggedError("ClaudeCodeFailure")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
