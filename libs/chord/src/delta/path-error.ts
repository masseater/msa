import { Schema } from "effect";

import type opsTypes from "./ops.types.ts";

const Seg = Schema.Union([Schema.String, Schema.Finite]);

export default class PathError extends Schema.TaggedError<
  PathError,
  { readonly brand: unique symbol }
>()("PathError", {
  message: Schema.String,
  path: Schema.Union([Schema.Array(Seg), Schema.Finite]),
}) {
  static create(path: opsTypes.Path | number): PathError {
    return PathError.make({ message: `unresolvable path: ${JSON.stringify(path)}`, path });
  }
}
