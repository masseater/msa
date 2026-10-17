import { homedir } from "node:os";

import { DateTime, Effect, Filter, Option, Schema, Stream } from "effect";

import type { HostShape } from "./host.ts";

const CostSchema = Schema.Struct({
  input: Schema.optional(Schema.Finite),
  output: Schema.optional(Schema.Finite),
  cacheRead: Schema.optional(Schema.Finite),
  cacheWrite: Schema.optional(Schema.Finite),
  total: Schema.optional(Schema.Finite),
});

const UsageSchema = Schema.Struct({
  input: Schema.optional(Schema.Finite),
  output: Schema.optional(Schema.Finite),
  cacheRead: Schema.optional(Schema.Finite),
  cacheWrite: Schema.optional(Schema.Finite),
  totalTokens: Schema.optional(Schema.Finite),
  cost: Schema.optional(CostSchema),
});

const MessageSchema = Schema.Struct({
  role: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  usage: Schema.optional(UsageSchema),
  timestamp: Schema.optional(Schema.Finite),
});

const SessionEntrySchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  message: Schema.optional(MessageSchema),
});

type Cost = typeof CostSchema.Type;
type Usage = typeof UsageSchema.Type;
type SessionEntry = typeof SessionEntrySchema.Type;

const decodeSessionEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(SessionEntrySchema));

const sessionEntryOf = Filter.makeEffect((line: string) => Effect.result(decodeSessionEntry(line)));

const sessionEntries = (options: {
  readonly file: string;
  readonly host: HostShape;
}): Stream.Stream<SessionEntry> =>
  options.host.lines(options.file).pipe(
    Stream.filter((line) => line.trim() !== ""),
    Stream.filterMapEffect(sessionEntryOf),
  );

const encodeSessionDir = (cwd: string): string =>
  `--${(cwd.startsWith("/") ? cwd.slice(1) : cwd).replaceAll("/", "-")}--`;

const defaultSessionsBase = (host: HostShape): string =>
  host.join(homedir(), ".msa", "agent", "sessions");

const jsonlFiles = (options: { readonly directory: string; readonly host: HostShape }) =>
  Effect.map(options.host.readDirectory(options.directory), (names) =>
    [...names.filter((name) => name.endsWith(".jsonl"))].sort(),
  );

const FILE_TIMESTAMP = /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u;

const parseMillis = (value: string): number | null => {
  const parsed = DateTime.make(value);
  return Option.isSome(parsed) ? DateTime.toEpochMillis(parsed.value) : null;
};

const sessionFileMillis = (options: {
  readonly file: string;
  readonly host: HostShape;
}): number | null => {
  const raw = options.host.basename(options.file).split("_")[0];
  if (raw === undefined || raw === "") return null;
  return parseMillis(raw.replace(FILE_TIMESTAMP, "T$1:$2:$3.$4Z"));
};

const jsonlFilesRecursive = (options: {
  readonly directory: string;
  readonly host: HostShape;
}): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const { directory, host } = options;
    const names = yield* host.readDirectory(directory);
    const found = yield* Effect.forEach([...names].sort(), (name) =>
      Effect.gen(function* () {
        const path = host.join(directory, name);
        const info = yield* host.stat(path);
        if (info.isDirectory) return yield* jsonlFilesRecursive({ directory: path, host });
        return info.isFile && name.endsWith(".jsonl") ? [path] : [];
      }),
    );
    return found.flat();
  });

export type { Cost, SessionEntry, Usage };
export {
  defaultSessionsBase,
  encodeSessionDir,
  jsonlFiles,
  jsonlFilesRecursive,
  parseMillis,
  sessionEntries,
  sessionFileMillis,
};
