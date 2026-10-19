import { Data } from "effect";

export class ToolFailure extends Data.TaggedError("ToolFailure")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
