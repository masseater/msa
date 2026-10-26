import { Schema } from "effect";

export default class E extends Schema.TaggedError<E>()("E", {
  message: Schema.String,
  retry: Schema.optionalKey(Schema.Boolean),
}) {}
