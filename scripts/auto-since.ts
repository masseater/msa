import { Data, DateTime, Effect, Option } from "effect";

import type { HostShape } from "./host.ts";

interface SinceFilter {
  readonly ms: number;
  readonly source: string;
}

class SinceError extends Data.TaggedError("SinceError")<{ readonly message: string }> {}

const fileSince = (host: HostShape, autoSincePath: string) =>
  Effect.gen(function* () {
    if (!(yield* host.exists(autoSincePath))) return null;
    const info = yield* host.stat(autoSincePath);
    const birth = info.birthtimeMs;
    const ms = birth !== undefined && Number.isFinite(birth) && birth > 0 ? birth : info.mtimeMs;
    return ms !== undefined && Number.isFinite(ms) && ms > 0
      ? { ms, source: `birth time of ${autoSincePath}` }
      : null;
  });

const resolveSince = (options: {
  readonly allSessions: boolean;
  readonly autoSincePath: string | undefined;
  readonly host: HostShape;
  readonly since: string | undefined;
}): Effect.Effect<SinceFilter | null, SinceError> =>
  Effect.gen(function* () {
    if (options.allSessions) return null;
    if (options.since !== undefined && options.since !== "") {
      const parsed = DateTime.make(options.since);
      if (Option.isNone(parsed)) {
        return yield* new SinceError({ message: `Invalid --since value: ${options.since}` });
      }
      return {
        ms: DateTime.toEpochMillis(parsed.value),
        source: `--since ${options.since}`,
      };
    }
    const { autoSincePath } = options;
    if (autoSincePath === undefined || autoSincePath === "") return null;
    return yield* fileSince(options.host, autoSincePath);
  });

export type { SinceFilter };
export { resolveSince, SinceError };
