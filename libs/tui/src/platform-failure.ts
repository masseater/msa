import { Data } from "effect";

export default class PlatformFailure extends Data.TaggedError("PlatformFailure")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
