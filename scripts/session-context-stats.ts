import { homedir } from "node:os";

import { Console, Data, DateTime, Effect, Option, Schema } from "effect";

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

const VALUE_ARGS = new Set([
  "--bash-contains",
  "--cwd",
  "--model",
  "--model-prefix",
  "--sessions-dir",
  "--since",
]);

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

const takeValue = (args: ReadonlyArray<string>, index: number) =>
  Effect.gen(function* () {
    const value = args[index + 1];
    if (value === undefined) {
      return yield* new SessionContextStatsError({
        message: `Missing value for argument: ${args[index] ?? ""}`,
      });
    }
    return value;
  });

const applyValueArg = (parsed: Args, arg: string, value: string): void => {
  if (arg === "--sessions-dir") parsed.sessionsDir = value;
  else if (arg === "--since") parsed.since = value;
  else if (arg === "--model") parsed.modelFilter = value;
  else if (arg === "--cwd") parsed.cwd = value;
  else if (arg === "--model-prefix") parsed.modelPrefixes.push(value);
  else parsed.bashContains.push(value);
};

const applyFlagArg = (parsed: Args, arg: string): boolean => {
  if (arg === "--json") parsed.json = true;
  else if (arg === "--text") parsed.text = true;
  else if (arg === "--all-sessions") parsed.allSessions = true;
  else if (arg === "--all-cwds") parsed.cwd = undefined;
  else if (arg === "--git-commit-or-push") parsed.bashContains.push("git commit", "git push");
  else return false;
  return true;
};

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
        applyValueArg(parsed, arg, yield* takeValue(args, index));
        index += 1;
      } else if (!applyFlagArg(parsed, arg)) {
        return yield* new SessionContextStatsError({ message: `Unknown argument: ${arg}` });
      }
    }
    return parsed;
  });

const sinceMillisOf = (since: string | undefined) =>
  Effect.gen(function* () {
    if (since === undefined) return null;
    const parsed = DateTime.make(since);
    if (Option.isNone(parsed)) {
      return yield* new SessionContextStatsError({ message: `Invalid --since value: ${since}` });
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
