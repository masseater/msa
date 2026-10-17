import { Data } from "effect";

import type { Path } from "./ops.ts";

export class PathError extends Data.TaggedError("PathError")<{
  readonly path: Path | number;
  readonly message: string;
}> {
  constructor(path: Path | number) {
    super({ path, message: `unresolvable path: ${JSON.stringify(path)}` });
  }
}
