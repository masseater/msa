import { Data } from "effect";

export default class DoomEngineError extends Data.TaggedError("DoomEngineError")<{
  readonly message: string;
}> {}
