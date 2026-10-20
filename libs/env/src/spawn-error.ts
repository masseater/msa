import { Data } from "effect";

export default class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}
