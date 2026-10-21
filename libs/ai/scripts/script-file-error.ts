import { Data } from "effect";

class ScriptFileError extends Data.TaggedError("ScriptFileError")<{
  readonly message: string;
}> {}

export default ScriptFileError;
