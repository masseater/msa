import { Data } from "effect";

import type opsTypes from "./ops.types.ts";

export default class PathError extends Data.TaggedError("PathError")<{
  readonly path: opsTypes.Path | number;
  readonly message: string;
}> {
  constructor(path: opsTypes.Path | number) {
    super({ message: `unresolvable path: ${JSON.stringify(path)}`, path });
  }
}
