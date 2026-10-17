import { Data } from "effect";

import type { Seg } from "./ops.ts";

export class UnsafePathError extends Data.TaggedError("UnsafePathError")<{
  readonly segment: Seg;
  readonly message: string;
}> {
  constructor(segment: Seg) {
    super({ segment, message: `unsafe path segment: ${String(segment)}` });
  }
}
