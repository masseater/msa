import { Schema } from "effect";

export default class JsonlStoragePoisonedError extends Schema.TaggedError<
  JsonlStoragePoisonedError,
  { readonly brand: unique symbol }
>()("JsonlStoragePoisonedError", { cause: Schema.instanceOf(Error), message: Schema.String }) {
  static create(cause: Error): JsonlStoragePoisonedError {
    return JsonlStoragePoisonedError.make({
      cause,
      message: "JSONL storage is poisoned and must be reopened",
    });
  }
}
