import { Data, DateTime, Effect, Option } from "effect";

import type { HostShape } from "./host.ts";
import { formatIsoMillis } from "./stats-format.ts";

interface SinceFilter {
  readonly ms: number;
  readonly source: string;
}

class SinceError extends Data.TaggedError("SinceError")<{ readonly message: string }> {}

const isPositiveFinite = (ms: number | undefined): ms is number =>
  ms !== undefined && Number.isFinite(ms) && ms > 0;

const fileSince = (host: HostShape, autoSincePath: string) =>
  Effect.gen(function* () {
    if (!(yield* host.exists(autoSincePath))) return null;
    const info = yield* host.stat(autoSincePath);
    const ms = isPositiveFinite(info.birthtimeMs) ? info.birthtimeMs : info.mtimeMs;
    return isPositiveFinite(ms) ? { ms, source: `birth time of ${autoSincePath}` } : null;
  });

const isNonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const explicitSince = (since: string): Effect.Effect<SinceFilter, SinceError> => {
  const parsed = DateTime.make(since);
  return Option.isNone(parsed)
    ? Effect.fail(new SinceError({ message: `Invalid --since value: ${since}` }))
    : Effect.succeed({ ms: DateTime.toEpochMillis(parsed.value), source: `--since ${since}` });
};

const resolveSince = (options: {
  readonly allSessions: boolean;
  readonly autoSincePath: string | undefined;
  readonly host: HostShape;
  readonly since: string | undefined;
}): Effect.Effect<SinceFilter | null, SinceError> =>
  Effect.gen(function* () {
    if (options.allSessions) return null;
    if (isNonEmpty(options.since)) return yield* explicitSince(options.since);
    const { autoSincePath } = options;
    return isNonEmpty(autoSincePath) ? yield* fileSince(options.host, autoSincePath) : null;
  });

const describeSince = (
  since: SinceFilter | null,
): { readonly ms: number; readonly iso: string; readonly source: string } | null =>
  since === null ? null : { ms: since.ms, iso: formatIsoMillis(since.ms), source: since.source };

export type { SinceFilter };
export { describeSince, resolveSince, SinceError };
