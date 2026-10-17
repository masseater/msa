import { Data } from "effect";

export class PlatformFailure extends Data.TaggedError("PlatformFailure")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
