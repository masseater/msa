import { DateTime, Effect, Option } from "effect";

import type autoSinceTypes from "./auto-since.types.ts";
import type hostTypes from "./host.types.ts";
import SinceError from "./since-error.ts";
import statsFormat from "./stats-format.ts";

const { formatIsoMillis } = statsFormat;

const isPositiveFinite = (ms: number | undefined): ms is number =>
  ms !== undefined && Number.isFinite(ms) && ms > 0;

const fileSince = (host: hostTypes.HostShape, autoSincePath: string) =>
  Effect.gen(function* () {
    if (!(yield* host.exists(autoSincePath))) return null;
    const info = yield* host.stat(autoSincePath);
    const ms = isPositiveFinite(info.birthtimeMs) ? info.birthtimeMs : info.mtimeMs;
    return isPositiveFinite(ms) ? { ms, source: `birth time of ${autoSincePath}` } : null;
  });

const isNonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const explicitSince = (since: string): Effect.Effect<autoSinceTypes.SinceFilter, SinceError> => {
  const parsed = DateTime.make(since);
  return Option.isNone(parsed)
    ? Effect.fail(new SinceError({ message: `Invalid --since value: ${since}` }))
    : Effect.succeed({ ms: DateTime.toEpochMillis(parsed.value), source: `--since ${since}` });
};

const resolveSince = (options: {
  readonly allSessions: boolean;
  readonly autoSincePath: string | undefined;
  readonly host: hostTypes.HostShape;
  readonly since: string | undefined;
}): Effect.Effect<autoSinceTypes.SinceFilter | null, SinceError> =>
  Effect.gen(function* () {
    if (options.allSessions) return null;
    if (isNonEmpty(options.since)) return yield* explicitSince(options.since);
    const { autoSincePath } = options;
    return isNonEmpty(autoSincePath) ? yield* fileSince(options.host, autoSincePath) : null;
  });

const describeSince = (
  since: autoSinceTypes.SinceFilter | null,
): { readonly ms: number; readonly iso: string; readonly source: string } | null =>
  since === null ? null : { iso: formatIsoMillis(since.ms), ms: since.ms, source: since.source };

const autoSince = {
  SinceError,
  describeSince,
  resolveSince,
};

export default autoSince;
