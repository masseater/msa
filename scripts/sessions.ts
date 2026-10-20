import { homedir } from "node:os";

import { DateTime, Effect, Filter, Option, Result, Schema, Stream } from "effect";

import type autoSinceTypes from "./auto-since.types.ts";
import type hostTypes from "./host.types.ts";
import sessionsSchema from "./sessions-schema.ts";
import type sessionsTypes from "./sessions.types.ts";

const { CostSchema, SessionEntrySchema, UsageSchema } = sessionsSchema;

const messageOf = <M>(entry: {
  readonly message?: M | undefined;
  readonly type?: string | undefined;
}): M | undefined => (entry.type === "message" ? entry.message : undefined);

const assistantMessageOf = (
  entry: sessionsTypes.SessionEntry,
): NonNullable<sessionsTypes.SessionEntry["message"]> | undefined => {
  const message = messageOf(entry);
  return message?.role === "assistant" ? message : undefined;
};

const decodeSessionEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(SessionEntrySchema));

const sessionEntryOf = Filter.makeEffect((line: string) => Effect.result(decodeSessionEntry(line)));

const sessionEntries = (options: {
  readonly file: string;
  readonly host: hostTypes.HostShape;
}): Stream.Stream<sessionsTypes.SessionEntry> =>
  options.host.lines(options.file).pipe(
    Stream.filter((line) => line.trim() !== ""),
    Stream.filterMapEffect(sessionEntryOf),
  );

const encodeSessionDir = (cwd: string): string =>
  `--${(cwd.startsWith("/") ? cwd.slice(1) : cwd).replaceAll("/", "-")}--`;

const defaultSessionsBase = (host: hostTypes.HostShape): string =>
  host.join(homedir(), ".msa", "agent", "sessions");

const jsonlFiles = (options: { readonly directory: string; readonly host: hostTypes.HostShape }) =>
  Effect.map(options.host.readDirectory(options.directory), (names) =>
    [...names.filter((name) => name.endsWith(".jsonl"))].sort(),
  );

const FILE_TIMESTAMP = /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u;

const parseMillis = (value: string): number | null => {
  const parsed = DateTime.make(value);
  return Option.isSome(parsed) ? DateTime.toEpochMillis(parsed.value) : null;
};

const timestampMillis = (timestamp: string | undefined): number | null =>
  timestamp === undefined ? null : parseMillis(timestamp);

const forEachDecodedLine = <A, E>(options: {
  readonly decode: (line: string) => Effect.Effect<A, E>;
  readonly file: string;
  readonly host: hostTypes.HostShape;
  readonly onEntry: (entry: A) => void;
  readonly onMalformed: () => void;
}): Effect.Effect<void> =>
  options.host.lines(options.file).pipe(
    Stream.filter((line) => line.trim() !== ""),
    Stream.runForEach((line) =>
      Effect.result(options.decode(line)).pipe(
        Effect.map(Result.match({ onFailure: options.onMalformed, onSuccess: options.onEntry })),
      ),
    ),
  );

const sessionFileMillis = (options: {
  readonly file: string;
  readonly host: hostTypes.HostShape;
}): number | null => {
  const raw = options.host.basename(options.file).split("_")[0];
  if (raw === undefined || raw === "") return null;
  return parseMillis(raw.replace(FILE_TIMESTAMP, "T$1:$2:$3.$4Z"));
};

const jsonlFilesRecursive = (options: {
  readonly directory: string;
  readonly host: hostTypes.HostShape;
}): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const { directory, host } = options;
    const names = yield* host.readDirectory(directory, { recursive: true });
    const paths = [...names]
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) => host.join(directory, name));
    const found = yield* Effect.forEach(paths, (path) =>
      Effect.map(host.stat(path), (info) => (info.isFile ? [path] : [])),
    );
    return found.flat();
  });

const isOlderThan = (fileMillis: number | null, sinceMs: number | null): boolean =>
  sinceMs !== null && fileMillis !== null && fileMillis < sinceMs;

const forEachSessionFile = (options: {
  readonly counts: sessionsTypes.SessionFileCounts;
  readonly host: hostTypes.HostShape;
  readonly scan: (file: {
    readonly sessionFile: string;
    readonly sessionMillis: number | null;
  }) => Effect.Effect<void>;
  readonly sessionsDir: string;
  readonly sinceMs: number | null;
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { counts, host } = options;
    const files = yield* jsonlFilesRecursive({ directory: options.sessionsDir, host });
    yield* Effect.forEach(files, (sessionFile) =>
      Effect.gen(function* () {
        counts.sessionFilesScanned += 1;
        const sessionMillis = sessionFileMillis({ file: sessionFile, host });
        if (isOlderThan(sessionMillis, options.sinceMs)) {
          counts.sessionFilesSkippedOlderThanSince += 1;
          return;
        }
        counts.sessionFilesIncluded += 1;
        yield* options.scan({ sessionFile, sessionMillis });
      }),
    );
  });

const emptySessionFileCounts = (): sessionsTypes.SessionFileCounts => ({
  sessionFilesIncluded: 0,
  sessionFilesScanned: 0,
  sessionFilesSkippedOlderThanSince: 0,
});

const collectSessionRecords = <R>(options: {
  readonly counts: sessionsTypes.SessionFileCounts;
  readonly host: hostTypes.HostShape;
  readonly scanFile: (file: {
    readonly sessionFile: string;
    readonly sessionMillis: number | null;
  }) => Effect.Effect<ReadonlyArray<R>>;
  readonly sessionsDir: string;
  readonly since: autoSinceTypes.SinceFilter | null;
}): Effect.Effect<ReadonlyArray<R>> => {
  const records: Array<R> = [];
  return forEachSessionFile({
    counts: options.counts,
    host: options.host,
    scan: (file) =>
      Effect.map(options.scanFile(file), (found) => {
        records.push(...found);
      }),
    sessionsDir: options.sessionsDir,
    sinceMs: options.since === null ? null : options.since.ms,
  }).pipe(Effect.as(records));
};

const requireSessionsDir = <E>(options: {
  readonly fail: (message: string) => E;
  readonly host: hostTypes.HostShape;
  readonly sessionsDir: string;
}): Effect.Effect<void, E> =>
  Effect.flatMap(options.host.exists(options.sessionsDir), (exists) =>
    exists
      ? Effect.void
      : Effect.fail(options.fail(`Sessions directory not found: ${options.sessionsDir}`)),
  );

const sessions = {
  CostSchema,
  SessionEntrySchema,
  UsageSchema,
  assistantMessageOf,
  collectSessionRecords,
  defaultSessionsBase,
  emptySessionFileCounts,
  encodeSessionDir,
  forEachDecodedLine,
  forEachSessionFile,
  jsonlFiles,
  jsonlFilesRecursive,
  messageOf,
  parseMillis,
  requireSessionsDir,
  sessionEntries,
  sessionFileMillis,
  timestampMillis,
};

export default sessions;
