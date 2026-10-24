import { Schema } from "effect";

export default class JsonlCorruptionError extends Schema.TaggedError<
  JsonlCorruptionError,
  { readonly brand: unique symbol }
>()("JsonlCorruptionError", {
  cause: Schema.optionalKey(Schema.instanceOf(Error)),
  message: Schema.String,
}) {
  static create(message: string, cause?: Error): JsonlCorruptionError {
    return JsonlCorruptionError.make({ message, ...(cause === undefined ? {} : { cause }) });
  }
}
