import { Data, Effect } from "effect";

import ForeignError from "../platform/foreign-error.ts";

const causeOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

const primaryCode = (error: unknown): number => {
  if (typeof error !== "object" || error === null || !("errcode" in error)) return -1;
  return typeof error.errcode === "number" ? error.errcode & 0xff : -1;
};

const isLockWait = (error: unknown): boolean =>
  [SQLITE_BUSY, SQLITE_LOCKED].includes(primaryCode(error));

class IndexLocked extends Data.TaggedError("IndexLocked")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

const foreign = <A>(body: () => A): Effect.Effect<A, ForeignError> =>
  Effect.try({ catch: (cause) => new ForeignError({ cause, message: causeOf(cause) }), try: body });

const indexOpen = { IndexLocked, causeOf, foreign, isLockWait };

export default indexOpen;
