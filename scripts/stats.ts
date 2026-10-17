import { Console, Data, DateTime, Effect, Option, Stream } from "effect";

import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { defaultSessionsBase, encodeSessionDir, jsonlFiles, sessionEntries } from "./sessions.ts";
import type { SessionEntry, Usage } from "./sessions.ts";

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

class StatsError extends Data.TaggedError("StatsError")<{ readonly message: string }> {}

const HELP = `Usage: scripts/stats.ts [options]

Options:
  -n, --days <days>         Number of local calendar days to include (default: 7)
  -d, --dir, --cwd <path>   Project cwd to inspect (default: current cwd)
  --sessions-base <path>    Sessions base directory (default: ~/.msa/agent/sessions)
  -h, --help                Show this help`;

const createTotals = (): Totals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costInput: 0,
  costOutput: 0,
  costCacheRead: 0,
  costCacheWrite: 0,
  costTotal: 0,
  assistantMessages: 0,
  sessions: new Set<string>(),
});

const createDayStats = (): DayStats => ({
  ...createTotals(),
  providers: new Map<string, Totals>(),
});

const addUsage = (totals: Totals, usage: Usage, sessionFile: string): void => {
  const cost = usage.cost ?? {};
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  totals.totalTokens += usage.totalTokens ?? 0;
  totals.costInput += cost.input ?? 0;
  totals.costOutput += cost.output ?? 0;
  totals.costCacheRead += cost.cacheRead ?? 0;
  totals.costCacheWrite += cost.cacheWrite ?? 0;
  totals.costTotal += cost.total ?? 0;
  totals.assistantMessages += 1;
  totals.sessions.add(sessionFile);
};

const parseArgs = (host: HostShape) =>
  Effect.gen(function* () {
    const args = process.argv.slice(2);
    const parsed: Args = {
      days: 7,
      cwd: process.cwd(),
      sessionsBase: defaultSessionsBase(host),
    };
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      const value = args[index + 1];
      if ((arg === "--days" || arg === "-n") && value !== undefined) {
        parsed.days = Number.parseInt(value, 10);
        index += 1;
      } else if ((arg === "--cwd" || arg === "--dir" || arg === "-d") && value !== undefined) {
        parsed.cwd = host.resolve(value);
        index += 1;
      } else if (arg === "--sessions-base" && value !== undefined) {
        parsed.sessionsBase = host.resolve(value);
        index += 1;
      } else if (arg === "--help" || arg === "-h") {
        yield* Console.log(HELP);
        return yield* Effect.sync(() => process.exit(0));
      }
    }
    if (!Number.isInteger(parsed.days) || parsed.days <= 0) {
      return yield* new StatsError({ message: "--days must be a positive integer" });
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

const entryInstant = (entry: SessionEntry) =>
  DateTime.make(entry.message?.timestamp ?? entry.timestamp ?? 0);

const accumulate = (
  stats: Map<string, DayStats>,
  grandTotal: Totals,
  entry: SessionEntry,
  dayKey: string,
  file: string,
  usage: Usage,
): void => {
  const dayStats = stats.get(dayKey) ?? createDayStats();
  stats.set(dayKey, dayStats);
  const provider = entry.message?.provider ?? "unknown";
  const providerStats = dayStats.providers.get(provider) ?? createTotals();
  dayStats.providers.set(provider, providerStats);
  addUsage(dayStats, usage, file);
  addUsage(providerStats, usage, file);
  addUsage(grandTotal, usage, file);
};

const collect = (
  host: HostShape,
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
            const usage = entry.message?.usage;
            if (
              entry.type !== "message" ||
              entry.message?.role !== "assistant" ||
              usage === undefined
            ) {
              return;
            }
            const instant = entryInstant(entry);
            if (Option.isNone(instant)) return;
            const millis = DateTime.toEpochMillis(instant.value);
            if (millis < startMillis || millis >= endMillis) return;
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
  if (!(yield* host.exists(sessionsDir))) {
    return yield* new StatsError({ message: `Sessions directory not found: ${sessionsDir}` });
  }
  const today = DateTime.startOf(yield* DateTime.nowInCurrentZone, "day");
  const start = DateTime.subtract(today, { days: args.days - 1 });
  const end = DateTime.add(today, { days: 1 });
  yield* report(args, sessionsDir, start, end, yield* collect(host, sessionsDir, start, end));
});

runScript(program);
