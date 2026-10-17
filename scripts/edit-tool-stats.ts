import { homedir } from "node:os";

import { Console, Data, Effect, Schema } from "effect";

import { resolveSince } from "./auto-since.ts";
import { buildEditTextReport } from "./edit-tool-report.ts";
import { scanEditCalls } from "./edit-tool-scan.ts";
import type { EditRecord } from "./edit-tool-scan.ts";
import { buildEditSummary } from "./edit-tool-summary.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { IndentedJson } from "./json.ts";

const DEFAULT_TOP = 20;

const HELP = `Usage: node scripts/edit-tool-stats.ts [options]

Options:
  --sessions-dir <path>  Sessions directory (default: ~/.msa/agent/sessions)
  --model <substring>    Filter provider/model by substring
  --ext <extension>      Filter by file extension, e.g. .ts
  --failed-only          Include only failed edit calls
  --top <n>              Number of examples to show (default: ${DEFAULT_TOP})
  --since <iso>          Only scan session files created at or after this ISO time
  --all-sessions         Disable the automatic since filter
  --auto-since-path <p>  Use birth time of this file for the automatic since filter
  --json                 Print JSON summary instead of human report
  --include-records      Include raw records in JSON output
  -h, --help             Show this help
`;

interface Args {
  allSessions: boolean;
  autoSincePath: string | undefined;
  extFilter: string | undefined;
  failedOnly: boolean;
  includeRecords: boolean;
  json: boolean;
  modelFilter: string | undefined;
  sessionsDir: string;
  since: string | undefined;
  top: number;
}

class EditToolStatsError extends Data.TaggedError("EditToolStatsError")<{
  readonly message: string;
}> {}

const VALUE_ARGS = new Set([
  "--auto-since-path",
  "--ext",
  "--model",
  "--sessions-dir",
  "--since",
  "--top",
]);

const encodeIndentedJson = Schema.encodeEffect(IndentedJson);

const defaultArgs = (host: HostShape): Args => ({
  allSessions: false,
  autoSincePath: host.join(homedir(), ".msa", "agent", "extensions", "edit.ts"),
  extFilter: undefined,
  failedOnly: false,
  includeRecords: false,
  json: false,
  modelFilter: undefined,
  sessionsDir: host.join(homedir(), ".msa", "agent", "sessions"),
  since: undefined,
  top: DEFAULT_TOP,
});

const applyFlagArg = (parsed: Args, arg: string): boolean => {
  if (arg === "--json") parsed.json = true;
  else if (arg === "--include-records") parsed.includeRecords = true;
  else if (arg === "--failed-only") parsed.failedOnly = true;
  else if (arg === "--all-sessions") parsed.allSessions = true;
  else return false;
  return true;
};

const applyValueArg = (parsed: Args, arg: string, value: string) =>
  Effect.gen(function* () {
    if (arg === "--sessions-dir") parsed.sessionsDir = value;
    else if (arg === "--since") parsed.since = value;
    else if (arg === "--auto-since-path") parsed.autoSincePath = value;
    else if (arg === "--model") parsed.modelFilter = value;
    else if (arg === "--ext") parsed.extFilter = value.toLowerCase();
    else {
      const top = Number.parseInt(value, 10);
      if (!Number.isFinite(top) || top <= 0) {
        return yield* new EditToolStatsError({ message: "--top must be a positive integer" });
      }
      parsed.top = top;
    }
  });

const parseArgs = (host: HostShape) =>
  Effect.gen(function* () {
    const args = process.argv.slice(2);
    const parsed = defaultArgs(host);
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index] ?? "";
      if (arg === "--help" || arg === "-h") {
        yield* Console.log(HELP);
        return yield* Effect.sync(() => process.exit(0));
      }
      if (VALUE_ARGS.has(arg)) {
        yield* applyValueArg(parsed, arg, args[index + 1] ?? "");
        index += 1;
      } else if (!applyFlagArg(parsed, arg)) {
        return yield* new EditToolStatsError({ message: `Unknown argument: ${arg}` });
      }
    }
    return parsed;
  });

const matchesFilters = (record: EditRecord, args: Args): boolean => {
  const model = args.modelFilter?.toLowerCase();
  if (model !== undefined && model !== "" && !record.providerModel.toLowerCase().includes(model)) {
    return false;
  }
  if (
    args.extFilter !== undefined &&
    args.extFilter !== "" &&
    record.extension !== args.extFilter
  ) {
    return false;
  }
  return !(args.failedOnly && record.success !== false);
};

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = yield* parseArgs(host);
  const sessionsDir = host.resolve(args.sessionsDir);
  if (!(yield* host.exists(sessionsDir))) {
    return yield* new EditToolStatsError({
      message: `Sessions directory not found: ${sessionsDir}`,
    });
  }
  const since = yield* resolveSince({
    allSessions: args.allSessions,
    autoSincePath: args.autoSincePath,
    host,
    since: args.since,
  });
  const { meta, records } = yield* scanEditCalls({ host, sessionsDir, since });
  const filtered = records.filter((record) => matchesFilters(record, args));
  const summary = buildEditSummary({
    extFilter: args.extFilter,
    failedOnly: args.failedOnly,
    meta,
    modelFilter: args.modelFilter,
    records: filtered,
    top: args.top,
  });
  if (args.json) {
    return yield* Console.log(
      yield* encodeIndentedJson(args.includeRecords ? { summary, records: filtered } : { summary }),
    );
  }
  return yield* Console.log(buildEditTextReport(summary));
});

runScript(program);
