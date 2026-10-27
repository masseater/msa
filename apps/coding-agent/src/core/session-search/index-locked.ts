import { Data } from "effect";

export default class IndexLocked extends Data.TaggedError("IndexLocked")<{
  readonly cause: unknown;
  readonly message: string;
}> {}
