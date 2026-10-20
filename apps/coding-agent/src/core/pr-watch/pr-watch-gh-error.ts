import { Data } from "effect";

import type ghTypes from "./gh.types.ts";

export default class PrWatchGhError extends Data.TaggedError("PrWatchGhError")<{
  readonly kind: ghTypes.PrWatchFailure;
  readonly message: string;
}> {}
