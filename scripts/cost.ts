import { Console, DateTime, Effect, Option, Stream } from "effect";

import { helpOptions, ignoreUnknown, parseOptions, valueOption } from "./cli-options.ts";
import type { CliOption } from "./cli-options.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { getOrCreate } from "./maps.ts";
import {
  assistantMessageOf,
  defaultSessionsBase,
  encodeSessionDir,
  jsonlFiles,
  sessionEntries,
} from "./sessions.ts";
import type { Cost, SessionEntry } from "./sessions.ts";

interface DayCost {
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  requests: number;
}

interface Args {
  readonly days: number;
  readonly directory: string;
}

interface RawArgs {
  days: number | undefined;
  directory: string | undefined;
}

const HELP = `Usage: cost.ts -d <path> -n <days>
  -d, --dir <path>   Directory path (required)
  -n, --days <num>   Number of days to track (required)
  -h, --help         Show this help`;

const FILE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u;

const createDayCost = (): DayCost => ({
  total: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  requests: 0,
});

const COST_FIELDS = ["total", "input", "output", "cacheRead", "cacheWrite"] as const;

const addCost = (target: DayCost, cost: Cost): void => {
  for (const field of COST_FIELDS) target[field] += cost[field] ?? 0;
  target.requests += 1;
};

const mergeCost = (target: DayCost, source: DayCost): void => {
  target.total += source.total;
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.requests += source.requests;
};

const directoryOption = valueOption<RawArgs>((parsed, value) =>
  Effect.sync(() => {
    parsed.directory = value;
  }),
);

const daysOption = valueOption<RawArgs>((parsed, value) =>
  Effect.sync(() => {
    parsed.days = Number.parseInt(value ?? "", 10);
  }),
);

const OPTIONS = new Map<string, CliOption<RawArgs, never>>([
  ["--dir", directoryOption],
  ["-d", directoryOption],
  ["--days", daysOption],
  ["-n", daysOption],
  ...helpOptions(HELP),
]);

const isTrackedDays = (days: number | undefined): days is number =>
  days !== undefined && !Number.isNaN(days) && days !== 0;

const completeArgs = ({ days, directory }: RawArgs): Args | undefined =>
  directory !== undefined && isTrackedDays(days) ? { days, directory } : undefined;

const parseArgs = Effect.gen(function* () {
  const args = completeArgs(
    yield* parseOptions({
      args: process.argv.slice(2),
      options: OPTIONS,
      parsed: { days: undefined, directory: undefined },
      unknown: ignoreUnknown,
    }),
  );
  if (args === undefined) {
    yield* Console.error("Error: both --dir and --days are required");
    yield* Console.error("Run with --help for usage");
    return yield* Effect.sync(() => process.exit(1));
  }
  return args;
});

const fileInstant = (file: string): Option.Option<DateTime.Utc> => {
  const [stamp] = file.split("_");
  const match = FILE_TIMESTAMP.exec(stamp ?? "");
  if (match === null) return Option.none();
  const [, date, hour, minute, second, millis] = match;
  return DateTime.make(`${date}T${hour}:${minute}:${second}.${millis}Z`);
};

const describeCost = (label: string, cost: DayCost): string =>
  `  ${label.padEnd(15)} $${cost.total.toFixed(4).padStart(8)}  (${cost.requests} reqs, in: $${cost.input.toFixed(4)}, out: $${cost.output.toFixed(4)}, cache: $${(cost.cacheRead + cost.cacheWrite).toFixed(4)})`;

const entryCost = (entry: SessionEntry): Cost | undefined => assistantMessageOf(entry)?.usage?.cost;

const entryInstant = (entry: SessionEntry) => DateTime.make(entry.timestamp ?? 0);

const providerOf = (entry: SessionEntry): string => entry.message?.provider ?? "undefined";

const dayCostOf = (stats: Map<string, Map<string, DayCost>>, day: string, provider: string) =>
  getOrCreate(
    getOrCreate(stats, day, () => new Map<string, DayCost>()),
    provider,
    createDayCost,
  );

const recordEntryCost = (stats: Map<string, Map<string, DayCost>>, entry: SessionEntry): void => {
  const cost = entryCost(entry);
  const instant = entryInstant(entry);
  if (cost === undefined || Option.isNone(instant)) return;
  addCost(dayCostOf(stats, DateTime.formatIsoDateUtc(instant.value), providerOf(entry)), cost);
};

const collect = (host: HostShape, sessionsDir: string, cutoff: DateTime.Zoned) =>
  Effect.gen(function* () {
    const stats = new Map<string, Map<string, DayCost>>();
    const files = yield* jsonlFiles({ directory: sessionsDir, host });
    const cutoffMillis = DateTime.toEpochMillis(cutoff);
    const fresh = files.filter((file) =>
      Option.match(fileInstant(file), {
        onNone: () => false,
        onSome: (instant) => DateTime.toEpochMillis(instant) >= cutoffMillis,
      }),
    );
    yield* Effect.forEach(fresh, (file) =>
      sessionEntries({ file: host.join(sessionsDir, file), host }).pipe(
        Stream.runForEach((entry) => Effect.sync(() => recordEntryCost(stats, entry))),
      ),
    );
    return stats;
  });

const reportDay = (
  day: string,
  providers: Map<string, DayCost>,
  providerTotals: Map<string, DayCost>,
) =>
  Effect.gen(function* () {
    yield* Console.log(`\n${day}`);
    yield* Console.log("-".repeat(40));
    let dayTotal = 0;
    for (const provider of [...providers.keys()].sort()) {
      const cost = providers.get(provider) ?? createDayCost();
      dayTotal += cost.total;
      mergeCost(getOrCreate(providerTotals, provider, createDayCost), cost);
      yield* Console.log(describeCost(provider, cost));
    }
    yield* Console.log(`  ${"Day total:".padEnd(15)} $${dayTotal.toFixed(4).padStart(8)}`);
    return dayTotal;
  });

const reportDays = (
  stats: Map<string, Map<string, DayCost>>,
  providerTotals: Map<string, DayCost>,
) =>
  Effect.gen(function* () {
    let grandTotal = 0;
    for (const day of [...stats.keys()].sort()) {
      grandTotal += yield* reportDay(day, stats.get(day) ?? new Map(), providerTotals);
    }
    return grandTotal;
  });

const report = (args: Args, cutoff: DateTime.Zoned, stats: Map<string, Map<string, DayCost>>) =>
  Effect.gen(function* () {
    if (stats.size === 0) {
      yield* Console.log(`No sessions found in the last ${args.days} days for: ${args.directory}`);
      return yield* Effect.sync(() => process.exit(0));
    }
    yield* Console.log(`\nCost breakdown for: ${args.directory}`);
    yield* Console.log(
      `Period: last ${args.days} days (since ${DateTime.formatIsoDateUtc(cutoff)})`,
    );
    yield* Console.log("=".repeat(80));
    const providerTotals = new Map<string, DayCost>();
    const grandTotal = yield* reportDays(stats, providerTotals);
    yield* Console.log(`\n${"=".repeat(80)}`);
    yield* Console.log("TOTALS BY PROVIDER");
    yield* Console.log("-".repeat(40));
    yield* Effect.forEach([...providerTotals.keys()].sort(), (provider) =>
      Console.log(describeCost(provider, providerTotals.get(provider) ?? createDayCost())),
    );
    yield* Console.log("-".repeat(40));
    yield* Console.log(`  ${"GRAND TOTAL:".padEnd(15)} $${grandTotal.toFixed(4).padStart(8)}`);
    yield* Console.log("");
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = yield* parseArgs;
  const sessionsDir = host.join(defaultSessionsBase(host), encodeSessionDir(args.directory));
  if (!(yield* host.exists(sessionsDir))) {
    yield* Console.error(`Sessions directory not found: ${sessionsDir}`);
    return yield* Effect.sync(() => process.exit(1));
  }
  const cutoff = DateTime.startOf(
    DateTime.subtract(yield* DateTime.nowInCurrentZone, { days: args.days }),
    "day",
  );
  yield* report(args, cutoff, yield* collect(host, sessionsDir, cutoff));
});

runScript(program);
