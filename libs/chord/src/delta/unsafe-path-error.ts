import { Schema } from "effect";

import type opsTypes from "./ops.types.ts";

export default class UnsafePathError extends Schema.TaggedError<
  UnsafePathError,
  { readonly brand: unique symbol }
>()("UnsafePathError", {
  message: Schema.String,
  segment: Schema.Union([Schema.String, Schema.Finite]),
}) {
  static create(segment: opsTypes.Seg): UnsafePathError {
    return UnsafePathError.make({ message: `unsafe path segment: ${String(segment)}`, segment });
  }
}
