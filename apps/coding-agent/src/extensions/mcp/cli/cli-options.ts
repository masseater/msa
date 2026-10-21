import chalk from "chalk";

import configModule from "../../../config.ts";
import type cliInternalTypes from "../cli-internal.types.ts";

const { APP_NAME, CONFIG_DIR_NAME } = configModule;

const HELP = `${chalk.bold("Usage:")}
  ${APP_NAME} mcp add <server> [options] -- <command> [args...]
  ${APP_NAME} mcp add <server> [options] --url <url>
  ${APP_NAME} mcp remove <server> [-l]
  ${APP_NAME} mcp list [--json]
  ${APP_NAME} mcp login <server> [--timeout <seconds>]
  ${APP_NAME} mcp logout <server>

Configure and check MCP servers and sign in to OAuth servers without starting a session.
Reads ~/${CONFIG_DIR_NAME}/agent/mcp.json and, in trusted projects, ${CONFIG_DIR_NAME}/mcp.json.

Commands:
  add <server>            Add or replace a server in mcp.json
  remove <server>         Remove a server from mcp.json
  list                    Show state, tools, and errors (exits 1 on failure)
  login <server>          Sign in through the browser
  logout <server>         Delete the stored OAuth credentials

Options for add and remove:
  -l, --local             Use ${CONFIG_DIR_NAME}/mcp.json in the current project instead of the global file

Options for add:
  --url <url>             Streamable HTTP server URL (instead of a command)
  --env <KEY=VALUE>       Environment variable for a stdio server (repeatable)
  --cwd <dir>             Working directory for a stdio server
  --header <KEY=VALUE>    HTTP header (repeatable)
  --bearer-token-env-var <NAME>
                          Send "Authorization: Bearer \${NAME}"
  --oauth-client-id <id>  Pre-registered OAuth client id
  --oauth-client-secret <secret>
                          OAuth client secret (may be \${NAME} or !command)
  --oauth-callback-port <port>
                          Fixed OAuth callback port
  --oauth-client-name <name>
                          Client name sent when registering with the OAuth server
  --exposure <mode>       codemode (default), deferred, direct, or hidden
  --description <text>    What the server offers, shown in the system prompt

Other options:
  --json                  Print the list as JSON
  --timeout <seconds>     Time limit for the whole sign-in (default: 300)`;

const HELP_HINT = chalk.dim(`Use "${APP_NAME} mcp --help" for usage.`);

const OPTION_ALIASES = new Map([["-l", "--local"]]);

function parseOptions(
  args: string[],
  known: Record<string, "flag" | "value" | "list">,
  error: (line: string) => void,
  maxPositionals = Number.POSITIVE_INFINITY,
): cliInternalTypes.ParsedOptions | undefined {
  const positional: string[] = [];
  const values = new Map<string, string | true>();
  const lists = new Map<string, string[]>();
  for (let index = 0; index < args.length; index++) {
    const rawArg = args[index];
    if (rawArg === undefined) break;
    const arg = OPTION_ALIASES.get(rawArg) ?? rawArg;
    if (arg === "--" || positional.length >= maxPositionals) {
      positional.push(...args.slice(arg === "--" ? index + 1 : index));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const kind = known[name];
    if (kind === undefined) {
      error(`Unknown option ${arg}.\n${HELP_HINT}`);
      return undefined;
    }
    if (kind === "flag") {
      values.set(name, true);
      continue;
    }
    const value = args[++index];
    if (value === undefined) {
      error(`${arg} needs a value.`);
      return undefined;
    }
    if (kind === "list") lists.set(name, [...(lists.get(name) ?? []), value]);
    else values.set(name, value);
  }
  return { lists, positional, values };
}

function parsePairs(option: string, pairs: string[] | undefined, error: (line: string) => void) {
  if (pairs === undefined) return {};
  const record: Record<string, string> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      error(`--${option} expects KEY=VALUE, got "${pair}".`);
      return undefined;
    }
    record[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return record;
}

const cliOptions = { HELP, HELP_HINT, parseOptions, parsePairs };

export default cliOptions;
