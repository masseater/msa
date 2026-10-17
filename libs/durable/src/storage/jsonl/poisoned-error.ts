import { Data } from "effect";

export class JsonlStoragePoisonedError extends Data.TaggedError("JsonlStoragePoisonedError")<{
  readonly message: string;
  readonly cause: Error;
}> {
  constructor(cause: Error) {
    super({ message: "JSONL storage is poisoned and must be reopened", cause });
  }
}
