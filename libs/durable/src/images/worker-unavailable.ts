import { Data } from "effect";

export default class WorkerUnavailable extends Data.TaggedError("WorkerUnavailable")<{
  readonly message: string;
  readonly cause: unknown;
}> {}
