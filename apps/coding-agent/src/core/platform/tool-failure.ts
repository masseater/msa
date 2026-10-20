import { Data } from "effect";

export default class ToolFailure extends Data.TaggedError("ToolFailure")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
