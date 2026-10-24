import { Console, DateTime, Effect, Option, Schema, Stream } from "effect";

import cliOptions from "./cli-options.ts";
import type cliOptionsTypes from "./cli-options.types.ts";
import hostModule from "./host.ts";
import type hostTypes from "./host.types.ts";
import maps from "./maps.ts";
import sessionsModule from "./sessions.ts";
import type sessionsTypes from "./sessions.types.ts";

const {
  assistantMessageOf,
  defaultSessionsBase,
  encodeSessionDir,
  jsonlFiles,
  requireSessionsDir,
  sessionEntries,
} = sessionsModule;
const { helpOptions, ignoreUnknown, parseOptions, valueOption } = cliOptions;
const { Host, runScript } = hostModule;
const { getOrCreate } = maps;

interface Totals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
  assistantMessages: number;
  sessions: Set<string>;
}

interface DayStats extends Totals {
  providers: Map<string, Totals>;
}

interface Args {
  days: number;
  cwd: string;
  sessionsBase: string;
}

class StatsError extends Schema.TaggedError<StatsError, { readonly brand: unique symbol }>()(
  "StatsError",
  { message: Schema.String },
) {}

const HELP = `Usage: scripts/stats.ts [options]

Options:
  -n, --days <days>         Number of local calendar days to include (default: 7)
  -d, --dir, --cwd <path>   Project cwd to inspect (default: current cwd)
  --sessions-base <path>    Sessions base directory (default: ~/.msa/agent/sessions)
  -h, --help                Show this help`;

const createTotals = (): Totals => ({
  assistantMessages: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costCacheRead: 0,
  costCacheWrite: 0,
  costInput: 0,
  costOutput: 0,
  costTotal: 0,
  input: 0,
  output: 0,
  sessions: new Set<string>(),
  totalTokens: 0,
});

const createDayStats = (): DayStats => ({
  ...createTotals(),
  providers: new Map<string, Totals>(),
});

const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const;

const COST_FIELDS = [
  ["costInput", "input"],
  ["costOutput", "output"],
  ["costCacheRead", "cacheRead"],
  ["costCacheWrite", "cacheWrite"],
  ["costTotal", "total"],
] as const;

const addTokens = (totals: Totals, usage: sessionsTypes.Usage): void => {
  for (const field of TOKEN_FIELDS) totals[field] += usage[field] ?? 0;
};

const addCosts = (totals: Totals, cost: sessionsTypes.Cost): void => {
  for (const [target, source] of COST_FIELDS) totals[target] += cost[source] ?? 0;
};

const addUsage = (totals: Totals, usage: sessionsTypes.Usage, sessionFile: string): void => {
  addTokens(totals, usage);
  addCosts(totals, usage.cost ?? {});
  totals.assistantMessages += 1;
  totals.sessions.add(sessionFile);
};

const presentValue = (
  set: (parsed: Args, value: string) => void,
): cliOptionsTypes.CliOption<Args, never> =>
  valueOption((parsed, value) =>
    Effect.sync(() => {
      if (value !== undefined) set(parsed, value);
    }),
  );

const statsOptions = (
  host: hostTypes.HostShape,
): ReadonlyMap<string, cliOptionsTypes.CliOption<Args, never>> => {
  const days = presentValue((parsed, value) => {
    parsed.days = Number.parseInt(value, 10);
  });
  const cwd = presentValue((parsed, value) => {
    parsed.cwd = host.resolve(value);
  });
  return new Map<string, cliOptionsTypes.CliOption<Args, never>>([
    ["--days", days],
    ["-n", days],
    ["--cwd", cwd],
    ["--dir", cwd],
    ["-d", cwd],
    [
      "--sessions-base",
      presentValue((parsed, value) => {
        parsed.sessionsBase = host.resolve(value);
      }),
    ],
    ...helpOptions(HELP),
  ]);
};

const parseArgs = (host: hostTypes.HostShape) =>
  Effect.gen(function* () {
    const parsed = yield* parseOptions({
      args: process.argv.slice(2),
      options: statsOptions(host),
      parsed: { cwd: process.cwd(), days: 7, sessionsBase: defaultSessionsBase(host) },
      unknown: ignoreUnknown,
    });
    if (!Number.isInteger(parsed.days) || parsed.days <= 0) {
      return yield* StatsError.make({ message: "--days must be a positive integer" });
    }
    return { ...parsed, cwd: host.resolve(parsed.cwd) };
  });

const formatInt = (value: number): string => Math.round(value).toLocaleString("en-US");

const formatCost = (value: number): string => `$${value.toFixed(4)}`;

const printTotals = (label: string, totals: Totals) =>
  Console.log(
    `${label.padEnd(16)} messages: ${String(totals.assistantMessages).padStart(5)}  sessions: ${String(totals.sessions.size).padStart(3)}  ` +
      `input: ${formatInt(totals.input).padStart(12)}  output: ${formatInt(totals.output).padStart(10)}  ` +
      `cache read: ${formatInt(totals.cacheRead).padStart(13)}  cache write: ${formatInt(totals.cacheWrite).padStart(10)}  ` +
      `total: ${formatInt(totals.totalTokens).padStart(13)}  cost: ${formatCost(totals.costTotal).padStart(10)}`,
  );

const entryInstant = (entry: sessionsTypes.SessionEntry) =>
  DateTime.make(entry.message?.timestamp ?? entry.timestamp ?? 0);

const accumulate = (
  stats: Map<string, DayStats>,
  grandTotal: Totals,
  entry: sessionsTypes.SessionEntry,
  dayKey: string,
  file: string,
  usage: sessionsTypes.Usage,
): void => {
  const dayStats = getOrCreate(stats, dayKey, createDayStats);
  const provider = entry.message?.provider ?? "unknown";
  const providerStats = getOrCreate(dayStats.providers, provider, createTotals);
  addUsage(dayStats, usage, file);
  addUsage(providerStats, usage, file);
  addUsage(grandTotal, usage, file);
};

const instantWithin = (entry: sessionsTypes.SessionEntry, startMillis: number, endMillis: number) =>
  Option.filter(entryInstant(entry), (instant) => {
    const millis = DateTime.toEpochMillis(instant);
    return millis >= startMillis && millis < endMillis;
  });

const collect = (
  host: hostTypes.HostShape,
  sessionsDir: string,
  start: DateTime.Zoned,
  end: DateTime.Zoned,
) =>
  Effect.gen(function* () {
    const stats = new Map<string, DayStats>();
    const grandTotal = createTotals();
    const files = yield* jsonlFiles({ directory: sessionsDir, host });
    const startMillis = DateTime.toEpochMillis(start);
    const endMillis = DateTime.toEpochMillis(end);
    yield* Effect.forEach(files, (file) =>
      sessionEntries({ file: host.join(sessionsDir, file), host }).pipe(
        Stream.runForEach((entry) =>
          Effect.gen(function* () {
            const usage = assistantMessageOf(entry)?.usage;
            if (usage === undefined) return;
            const instant = instantWithin(entry, startMillis, endMillis);
            if (Option.isNone(instant)) return;
            const zoned = yield* DateTime.setZoneCurrent(instant.value);
            accumulate(stats, grandTotal, entry, DateTime.formatIsoDate(zoned), file, usage);
          }),
        ),
      ),
    );
    return { grandTotal, stats };
  });

const report = (
  args: Args,
  sessionsDir: string,
  start: DateTime.Zoned,
  end: DateTime.Zoned,
  collected: { readonly grandTotal: Totals; readonly stats: Map<string, DayStats> },
) =>
  Effect.gen(function* () {
    const lastDay = DateTime.subtractDuration(end, 1);
    yield* Console.log(`Usage for ${args.cwd}`);
    yield* Console.log(`Sessions: ${sessionsDir}`);
    yield* Console.log(
      `Period: ${DateTime.formatIsoDate(start)} through ${DateTime.formatIsoDate(lastDay)} (${args.days} local days)`,
    );
    yield* Console.log("".padEnd(160, "="));
    yield* Effect.forEach(
      [...collected.stats.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ([day, dayStats]) =>
        Effect.gen(function* () {
          yield* printTotals(day, dayStats);
          yield* Effect.forEach(
            [...dayStats.providers.entries()].sort(([a], [b]) => a.localeCompare(b)),
            ([provider, providerStats]) => printTotals(`  ${provider}`, providerStats),
          );
        }),
    );
    yield* Console.log("".padEnd(160, "-"));
    yield* printTotals("TOTAL", collected.grandTotal);
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = yield* parseArgs(host);
  const sessionsDir = host.join(args.sessionsBase, encodeSessionDir(args.cwd));
  yield* requireSessionsDir({ fail: (message) => StatsError.make({ message }), host, sessionsDir });
  const today = DateTime.startOf(yield* DateTime.nowInCurrentZone, "day");
  const start = DateTime.subtract(today, { days: args.days - 1 });
  const end = DateTime.add(today, { days: 1 });
  yield* report(args, sessionsDir, start, end, yield* collect(host, sessionsDir, start, end));
});

runScript(program);
