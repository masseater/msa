import { Effect } from "effect";

import errors from "../errors.ts";
import type typesModule from "./types.types.ts";
import Waiters from "./waiters.ts";

const { SessionFailed } = errors;

type Scan<T> = (
  cursor: typesModule.Cursor | undefined,
) => Promise<typesModule.Page<T, typesModule.Cursor>>;

const scanPage = <T>(scan: Scan<T>, cursor: typesModule.Cursor | undefined) =>
  Effect.promise(() => scan(cursor));

const scanAll = Effect.fnUntraced(function* <T>(scan: Scan<T>) {
  const items: T[] = [];
  let cursor: typesModule.Cursor | undefined;
  do {
    const page = yield* scanPage(scan, cursor);
    items.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  return items;
});

function closedError(session: {
  readonly failure: { readonly error: unknown } | undefined;
}): Error {
  const failure = session.failure;
  return failure === undefined ? new Error("Harness is closed") : new SessionFailed(failure.error);
}

const util = {
  Waiters,
  closedError,
  scanAll,
};

export default util;
