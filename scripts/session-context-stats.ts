import { homedir } from "node:os";

import { Console, Data, DateTime, Effect, Option, Schema } from "effect";

import { flagOption, helpOptions, parseOptions, requiredOption } from "./cli-options.ts";
import type { CliOption } from "./cli-options.ts";
import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";
import { IndentedJson } from "./json.ts";
import { REPORT_TIME_ZONE, reportZone } from "./report-zone.ts";
import { buildHtmlReport, buildTextReport } from "./session-context-report.ts";
import { scanSessions } from "./session-context-scan.ts";
import { buildSummary } from "./session-context-summary.ts";
import { loadContextWindows } from "./session-context-windows.ts";

const HELP = `Usage: node scripts/session-context-stats.ts [options]

Options:
  --sessions-dir <path>  Sessions directory (default: ~/.msa/agent/sessions)
  --model <substring>    Filter provider/model by substring
  --model-prefix <p>     Include provider/model prefixes, repeatable, e.g. openai-codex/
  --bash-contains <text> Include only sessions with bash tool calls containing text, repeatable
  --git-commit-or-push   Shortcut for --bash-contains "git commit" --bash-contains "git push"
  --cwd <path>           Include only sessions whose cwd is this path (default: current cwd)
  --all-cwds             Include sessions from all cwd values
  --since <iso>          Only scan session files created at or after this ISO time
  --all-sessions         Scan all sessions (default already scans all)
  --json                 Print JSON instead of HTML report
  --text                 Print plain text instead of HTML report
  -h, --help             Show this help
`;

interface Args {
  allSessions: boolean;
  bashContains: Array<string>;
  cwd: string | undefined;
  json: boolean;
  modelFilter: string | undefined;
  modelPrefixes: Array<string>;
  sessionsDir: string;
  since: string | undefined;
  text: boolean;
}

class SessionContextStatsError extends Data.TaggedError("SessionContextStatsError")<{
  readonly message: string;
}> {}

const encodeIndentedJson = Schema.encodeEffect(IndentedJson);

const defaultArgs = (host: HostShape): Args => ({
  allSessions: false,
  bashContains: [],
  cwd: process.cwd(),
  json: false,
  modelFilter: undefined,
  modelPrefixes: [],
  sessionsDir: host.join(homedir(), ".msa", "agent", "sessions"),
  since: undefined,
  text: false,
});

const fail = (message: string) => new SessionContextStatsError({ message });

const requiredValue = (
  name: string,
  set: (parsed: Args, value: string) => void,
): readonly [string, CliOption<Args, SessionContextStatsError>] =>
  requiredOption({
    apply: (parsed, value) => Effect.sync(() => set(parsed, value)),
    missing: (option) => fail(`Missing value for argument: ${option}`),
    name,
  });

const flag = (
  name: string,
  set: (parsed: Args) => void,
): readonly [string, CliOption<Args, SessionContextStatsError>] => [name, flagOption(set)];

const OPTIONS = new Map<string, CliOption<Args, SessionContextStatsError>>([
  requiredValue("--sessions-dir", (parsed, value) => {
    parsed.sessionsDir = value;
  }),
  requiredValue("--since", (parsed, value) => {
    parsed.since = value;
  }),
  requiredValue("--model", (parsed, value) => {
    parsed.modelFilter = value;
  }),
  requiredValue("--cwd", (parsed, value) => {
    parsed.cwd = value;
  }),
  requiredValue("--model-prefix", (parsed, value) => {
    parsed.modelPrefixes.push(value);
  }),
  requiredValue("--bash-contains", (parsed, value) => {
    parsed.bashContains.push(value);
  }),
  flag("--json", (parsed) => {
    parsed.json = true;
  }),
  flag("--text", (parsed) => {
    parsed.text = true;
  }),
  flag("--all-sessions", (parsed) => {
    parsed.allSessions = true;
  }),
  flag("--all-cwds", (parsed) => {
    parsed.cwd = undefined;
  }),
  flag("--git-commit-or-push", (parsed) => {
    parsed.bashContains.push("git commit", "git push");
  }),
  ...helpOptions(HELP),
]);

const parseArgs = (host: HostShape) =>
  parseOptions({
    args: process.argv.slice(2),
    options: OPTIONS,
    parsed: defaultArgs(host),
    unknown: (arg) => Effect.fail(fail(`Unknown argument: ${arg}`)),
  });

const sinceMillisOf = (since: string | undefined) =>
  Effect.gen(function* () {
    if (since === undefined) return null;
    const parsed = DateTime.make(since);
    if (Option.isNone(parsed)) {
      return yield* fail(`Invalid --since value: ${since}`);
    }
    return DateTime.toEpochMillis(parsed.value);
  });

const report = (options: {
  readonly args: Args;
  readonly summary: ReturnType<typeof buildSummary>;
}) =>
  Effect.gen(function* () {
    if (options.args.json) return yield* Console.log(yield* encodeIndentedJson(options.summary));
    if (options.args.text) return yield* Console.log(buildTextReport(options.summary));
    return yield* Console.log(buildHtmlReport(options.summary));
  });

const program = Effect.gen(function* () {
  const host = yield* Host;
  const args = yield* parseArgs(host);
  const { day } = yield* reportZone;
  const windows = yield* loadContextWindows(host);
  const cwdFilter = args.cwd === undefined ? undefined : host.resolve(args.cwd);
  const { meta, sessions } = yield* scanSessions({
    cwdFilter,
    host,
    sessionsDir: host.resolve(args.sessionsDir),
    sinceMs: yield* sinceMillisOf(args.since),
    windows,
  });
  const summary = buildSummary({
    bashContains: args.bashContains,
    cwd: cwdFilter ?? null,
    day,
    modelFilter: args.modelFilter,
    modelPrefixes: args.modelPrefixes,
    scan: { ...meta, contextWindowSources: windows.sources, timezone: REPORT_TIME_ZONE },
    sessions,
  });
  yield* report({ args, summary });
});

runScript(program);
