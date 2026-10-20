import { Data } from "effect";

export default class JsonlStoragePoisonedError extends Data.TaggedError(
  "JsonlStoragePoisonedError",
)<{
  readonly message: string;
  readonly cause: Error;
}> {
  constructor(cause: Error) {
    super({ cause, message: "JSONL storage is poisoned and must be reopened" });
  }
}
