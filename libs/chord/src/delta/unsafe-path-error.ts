import { Data } from "effect";

import type opsTypes from "./ops.types.ts";

export default class UnsafePathError extends Data.TaggedError("UnsafePathError")<{
  readonly segment: opsTypes.Seg;
  readonly message: string;
}> {
  constructor(segment: opsTypes.Seg) {
    super({ message: `unsafe path segment: ${String(segment)}`, segment });
  }
}
