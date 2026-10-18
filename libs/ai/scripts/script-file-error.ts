import { Data } from "effect";

export class ScriptFileError extends Data.TaggedError("ScriptFileError")<{
  readonly message: string;
}> {}
