import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import awaitingModule from "./awaiting.ts";
import platform from "./platform/index.ts";

const { join } = platform;
const { awaited, awaiting } = awaitingModule;
const { makeDirectory } = platform.files;

const LOCK_STALE_MS = 20_000;
const LOCK_WAIT_MS = 25_000;
const LOCK_RETRY_MS = 100;

const withDirectoryLock = <T>(
  lockDir: string | undefined,
  name: string,
  fn: () => Promise<T>,
): Promise<T> =>
  Effect.runPromise(
    awaiting(function* () {
      if (lockDir === undefined || lockDir === "") return yield* awaited(fn());
      yield* awaited(makeDirectory({ mode: 0o700, path: lockDir }));
      const release = yield* awaited(
        lockfile.lock(join(lockDir, name), {
          onCompromised: () => {},
          realpath: false,
          retries: {
            factor: 1,
            maxTimeout: LOCK_RETRY_MS,
            minTimeout: LOCK_RETRY_MS,
            retries: LOCK_WAIT_MS / LOCK_RETRY_MS,
          },
          stale: LOCK_STALE_MS,
        }),
      );
      try {
        return yield* awaited(fn());
      } finally {
        yield* awaited(release().catch(() => undefined));
      }
    }),
  );

const directoryLock = { withDirectoryLock };

export default directoryLock;
