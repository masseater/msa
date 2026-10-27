import { Duration, Effect, Schedule } from "effect";

import ForeignError from "../platform/foreign-error.ts";
import sqliteFile from "../platform/node/sqlite-file.ts";
import type DatabaseSync from "../platform/node/sqlite.ts";
import platformRuntime from "../platform/runtime.ts";
import indexStore from "./index-store.ts";

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

const lockedError = (indexPath: string, failure: unknown): Error =>
  new Error(
    `The session index ${indexPath} stayed locked by another process (${causeOf(failure)}); search again once it finishes`,
    { cause: failure },
  );

function openOrReplace(indexPath: string): DatabaseSync {
  try {
    return indexStore.openIndex(indexPath);
  } catch (failure) {
    if (isLockWait(failure)) throw failure;
    try {
      sqliteFile.removeSqliteFile(indexPath);
      return indexStore.openIndex(indexPath);
    } catch (error) {
      throw new Error(
        `The session index ${indexPath} could not be opened (${causeOf(failure)}) or replaced (${causeOf(error)})`,
        { cause: error },
      );
    }
  }
}

const OPEN_RETRY = Schedule.spaced(Duration.millis(50));
const OPEN_RETRIES = 600;

const openIndexWaiting = (indexPath: string): Promise<DatabaseSync> =>
  platformRuntime
    .runPromise(
      Effect.try({
        catch: (cause) => new ForeignError({ cause, message: causeOf(cause) }),
        try: () => openOrReplace(indexPath),
      }).pipe(
        Effect.retry({
          schedule: OPEN_RETRY,
          times: OPEN_RETRIES,
          while: (failure) => isLockWait(failure.cause),
        }),
      ),
    )
    .catch((failure: unknown) => {
      const cause = failure instanceof ForeignError ? failure.cause : failure;
      throw isLockWait(cause) ? lockedError(indexPath, cause) : cause;
    });

const indexOpen = { causeOf, isLockWait, lockedError, openIndexWaiting };

export default indexOpen;
