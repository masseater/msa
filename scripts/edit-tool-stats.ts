import { homedir } from "node:os";

import { Console, Data, Effect, Schema } from "effect";

import cliOptions from "./cli-options.ts";
import editToolReport from "./edit-tool-report.ts";
import editToolScan from "./edit-tool-scan.ts";
import type editToolStatsTypes from "./edit-tool-stats.types.ts";
import editToolSummary from "./edit-tool-summary.ts";
import hostModule from "./host.ts";
import jsonModule from "./json.ts";
import scanOptionsModule from "./scan-options.ts";

const { IndentedJson } = jsonModule;
const { Host, runScript } = hostModule;
const { flagOption, parseCommandLine, stringOption } = cliOptions;
const { matchesModelFilter, resolveScanScope, scanOptions } = scanOptionsModule;
const { scanEditCalls } = editToolScan;
const { buildEditSummary } = editToolSummary;
const { buildEditTextReport } = editToolReport;

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

const encodeIndentedJson = Schema.encodeEffect(IndentedJson);

const defaultArgs = (host: editToolStatsTypes.HostShape): Args => ({
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

const fail = (message: string) => new EditToolStatsError({ message });

const OPTIONS: ReadonlyArray<
  readonly [string, editToolStatsTypes.CliOption<Args, EditToolStatsError>]
> = [
  ...scanOptions<Args, EditToolStatsError>(fail),
  [
    "--ext",
    stringOption((parsed, value) => {
      parsed.extFilter = value.toLowerCase();
    }),
  ],
  [
    "--failed-only",
    flagOption((parsed) => {
      parsed.failedOnly = true;
    }),
  ],
];

const parseArgs = (host: editToolStatsTypes.HostShape) =>
  parseCommandLine({ defaults: defaultArgs(host), fail, help: HELP, options: OPTIONS });

const matchesExtension = (
  record: editToolStatsTypes.EditRecord,
  extFilter: string | undefined,
): boolean => extFilter === undefined || extFilter === "" || record.extension === extFilter;

const matchesFilters = (record: editToolStatsTypes.EditRecord, args: Args): boolean =>
  matchesModelFilter({ modelFilter: args.modelFilter, providerModel: record.providerModel }) &&
  matchesExtension(record, args.extFilter) &&
  !(args.failedOnly && record.success !== false);

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = yield* parseArgs(host);
  const { meta, records } = yield* scanEditCalls(yield* resolveScanScope({ args, fail, host }));
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
      yield* encodeIndentedJson(args.includeRecords ? { records: filtered, summary } : { summary }),
    );
  }
  return yield* Console.log(buildEditTextReport(summary));
});

runScript(program);
