import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import awaitingModule from "../../core/awaiting.ts";
import platform from "../../core/platform/index.ts";

const { join, sha256Hex } = platform;
const { awaited, awaiting } = awaitingModule;
const { makeDirectory } = platform.files;

const REFRESH_LOCK_STALE_MS = 20_000;
const REFRESH_LOCK_WAIT_MS = 25_000;
const REFRESH_LOCK_RETRY_MS = 100;

const withRefreshLock = <T>(
  lockDir: string | undefined,
  key: string,
  fn: () => Promise<T>,
): Promise<T> =>
  Effect.runPromise(
    awaiting(function* () {
      if (lockDir === undefined || lockDir === "") return yield* awaited(fn());
      yield* awaited(makeDirectory({ mode: 0o700, path: lockDir }));
      const hash = sha256Hex(key).slice(0, 16);
      const release = yield* awaited(
        lockfile.lock(join(lockDir, `mcp-auth-refresh-${hash}`), {
          onCompromised: () => {},
          realpath: false,
          retries: {
            factor: 1,
            maxTimeout: REFRESH_LOCK_RETRY_MS,
            minTimeout: REFRESH_LOCK_RETRY_MS,
            retries: REFRESH_LOCK_WAIT_MS / REFRESH_LOCK_RETRY_MS,
          },
          stale: REFRESH_LOCK_STALE_MS,
        }),
      );
      try {
        return yield* awaited(fn());
      } finally {
        yield* awaited(release().catch(() => undefined));
      }
    }),
  );

const mcpRefreshLock = { withRefreshLock };

export default mcpRefreshLock;
