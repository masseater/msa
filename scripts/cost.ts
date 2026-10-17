import { Console, DateTime, Effect, Option, Stream } from "effect";

import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { defaultSessionsBase, encodeSessionDir, jsonlFiles, sessionEntries } from "./sessions.ts";
import type { Cost } from "./sessions.ts";

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

const addCost = (target: DayCost, cost: Cost): void => {
  target.total += cost.total ?? 0;
  target.input += cost.input ?? 0;
  target.output += cost.output ?? 0;
  target.cacheRead += cost.cacheRead ?? 0;
  target.cacheWrite += cost.cacheWrite ?? 0;
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

const parseArgs = Effect.gen(function* () {
  const args = process.argv.slice(2);
  let directory: string | undefined;
  let days: number | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dir" || arg === "-d") {
      directory = args[++index];
    } else if (arg === "--days" || arg === "-n") {
      days = Number.parseInt(args[++index] ?? "", 10);
    } else if (arg === "--help" || arg === "-h") {
      yield* Console.log(HELP);
      return yield* Effect.sync(() => process.exit(0));
    }
  }
  if (directory === undefined || days === undefined || Number.isNaN(days) || days === 0) {
    yield* Console.error("Error: both --dir and --days are required");
    yield* Console.error("Run with --help for usage");
    return yield* Effect.sync(() => process.exit(1));
  }
  return { days, directory } satisfies Args;
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
        Stream.runForEach((entry) => {
          const cost = entry.message?.usage?.cost;
          if (
            entry.type !== "message" ||
            entry.message?.role !== "assistant" ||
            cost === undefined
          ) {
            return Effect.void;
          }
          const instant = DateTime.make(entry.timestamp ?? 0);
          if (Option.isNone(instant)) return Effect.void;
          const day = DateTime.formatIsoDateUtc(instant.value);
          const providers = stats.get(day) ?? new Map<string, DayCost>();
          stats.set(day, providers);
          const provider = entry.message.provider ?? "undefined";
          const dayCost = providers.get(provider) ?? createDayCost();
          providers.set(provider, dayCost);
          addCost(dayCost, cost);
          return Effect.void;
        }),
      ),
    );
    return stats;
  });

const reportDays = (
  stats: Map<string, Map<string, DayCost>>,
  providerTotals: Map<string, DayCost>,
) =>
  Effect.gen(function* () {
    let grandTotal = 0;
    const days = [...stats.keys()].sort();
    for (const day of days) {
      yield* Console.log(`\n${day}`);
      yield* Console.log("-".repeat(40));
      const providers = stats.get(day) ?? new Map<string, DayCost>();
      let dayTotal = 0;
      for (const provider of [...providers.keys()].sort()) {
        const cost = providers.get(provider) ?? createDayCost();
        dayTotal += cost.total;
        const totals = providerTotals.get(provider) ?? createDayCost();
        providerTotals.set(provider, totals);
        mergeCost(totals, cost);
        yield* Console.log(describeCost(provider, cost));
      }
      yield* Console.log(`  ${"Day total:".padEnd(15)} $${dayTotal.toFixed(4).padStart(8)}`);
      grandTotal += dayTotal;
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
