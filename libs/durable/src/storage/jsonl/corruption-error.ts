import { Data } from "effect";

export class JsonlCorruptionError extends Data.TaggedError("JsonlCorruptionError")<{
  readonly message: string;
  readonly cause?: Error;
}> {
  constructor(message: string, cause?: Error) {
    super({ message, ...(cause === undefined ? {} : { cause }) });
  }
}
