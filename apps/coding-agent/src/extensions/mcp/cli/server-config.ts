import configModule from "../../../config.ts";
import mcpServers from "../../../core/mcp-servers.ts";
import type mcpServersTypes from "../../../core/mcp-servers.types.ts";
import memoryModule from "../../../core/memory/memory.ts";
import platform from "../../../core/platform/index.ts";
import type cliInternalTypes from "../cli-internal.types.ts";
import type cliTypes from "../cli.types.ts";
import cliOptions from "./cli-options.ts";
import serverPersist from "./server-persist.ts";

const { APP_NAME, CONFIG_DIR_NAME } = configModule;
const { validateMcpServerConfig } = mcpServers;
const { SIGN_IN_HINT, isSepiaceServer } = memoryModule;
const { join } = platform;
const { removeConfiguredServer, saveAddedServer } = serverPersist;
const { HELP_HINT, parseOptions, parsePairs } = cliOptions;

type Line = (line: string) => void;
type Parsed = cliInternalTypes.ParsedOptions;

const ADD_OPTIONS = {
  "bearer-token-env-var": "value",
  cwd: "value",
  description: "value",
  env: "list",
  exposure: "value",
  header: "list",
  local: "flag",
  "oauth-callback-port": "value",
  "oauth-client-id": "value",
  "oauth-client-name": "value",
  "oauth-client-secret": "value",
  url: "value",
} as const;

const HTTP_ONLY = [
  "header",
  "bearer-token-env-var",
  "oauth-client-id",
  "oauth-client-secret",
  "oauth-callback-port",
  "oauth-client-name",
];
const STDIO_ONLY = ["env", "cwd"];

function projectConfigPath(options: cliTypes.McpCommandOptions): string {
  return join(options.cwd, CONFIG_DIR_NAME, "mcp.json");
}

function optionValue(parsed: Parsed, option: string): string | undefined {
  const found = parsed.values.get(option);
  return typeof found === "string" ? found : undefined;
}

function httpConfig(url: string, parsed: Parsed, error: Line) {
  const headers = parsePairs("header", parsed.lists.get("header"), error);
  if (headers === undefined) return undefined;
  const value = (option: string) => optionValue(parsed, option);
  const bearer = value("bearer-token-env-var");
  if (bearer !== undefined) headers["Authorization"] = `Bearer \${${bearer}}`;
  const port = value("oauth-callback-port");
  const oauth = {
    ...(value("oauth-client-id") === undefined ? {} : { clientId: value("oauth-client-id") }),
    ...(value("oauth-client-secret") === undefined
      ? {}
      : { clientSecret: value("oauth-client-secret") }),
    ...(port === undefined ? {} : { callbackPort: Number(port) }),
    ...(value("oauth-client-name") === undefined ? {} : { clientName: value("oauth-client-name") }),
  };
  return {
    url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(oauth).length > 0 ? { oauth } : {}),
  };
}

function stdioConfig(command: string[], parsed: Parsed, error: Line) {
  const env = parsePairs("env", parsed.lists.get("env"), error);
  if (env === undefined) return undefined;
  const [executable, ...commandArgs] = command;
  const cwd = optionValue(parsed, "cwd");
  return {
    command: executable,
    ...(commandArgs.length > 0 ? { args: commandArgs } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(cwd === undefined ? {} : { cwd }),
  };
}

function buildServerConfig(
  name: string,
  command: string[],
  parsed: Parsed,
  error: Line,
): mcpServersTypes.McpServerConfig | undefined {
  const url = parsed.values.get("url");
  const misplaced = (url === undefined ? HTTP_ONLY : STDIO_ONLY).find(
    (option) => parsed.values.has(option) || parsed.lists.has(option),
  );
  if (misplaced !== undefined && misplaced !== "") {
    error(
      `--${misplaced} only applies to ${url === undefined ? "HTTP servers (--url)" : "stdio servers"}.`,
    );
    return undefined;
  }
  const config: Record<string, unknown> | undefined =
    typeof url === "string" ? httpConfig(url, parsed, error) : stdioConfig(command, parsed, error);
  if (config === undefined) return undefined;
  const exposure = optionValue(parsed, "exposure");
  if (exposure !== undefined) config["exposure"] = exposure;
  const description = optionValue(parsed, "description");
  if (description !== undefined) config["description"] = description;
  const validated = validateMcpServerConfig(name, config);
  if (typeof validated === "string") {
    error(validated);
    return undefined;
  }
  return validated;
}

function add(
  args: string[],
  projectConfig: string,
  options: cliTypes.McpCommandOptions,
  log: Line,
  error: Line,
): Promise<number> {
  const parsed = parseOptions(args, ADD_OPTIONS, error, 2);
  if (parsed === undefined) return Promise.resolve(1);
  const [name, ...command] = parsed.positional;
  if (name === undefined || name === "" || !parsed.values.has("url") === (command.length === 0)) {
    error(
      `Usage: ${APP_NAME} mcp add <server> [options] (--url <url> | -- <command> [args...])\n${HELP_HINT}`,
    );
    return Promise.resolve(1);
  }
  const validated = buildServerConfig(name, command, parsed, error);
  if (validated === undefined) return Promise.resolve(1);
  if (isSepiaceServer(name, "url" in validated ? validated.url : undefined)) {
    error(
      `sepiace is long-term memory, not an MCP server, so mcp.json does not take it; ${SIGN_IN_HINT}.`,
    );
    return Promise.resolve(1);
  }
  const project = parsed.values.has("local");
  const path = project ? projectConfig : join(options.agentDir, "mcp.json");
  return saveAddedServer({ error, log, name, options, path, project, validated }).then((saved) => {
    if (!saved) return 1;
    const mayNeedSignIn =
      "url" in validated &&
      !Object.keys(validated.headers ?? {}).some(
        (header) => header.toLowerCase() === "authorization",
      );
    log(
      `Check it with: ${APP_NAME} mcp list${mayNeedSignIn ? `. If it requires sign-in: ${APP_NAME} mcp login ${name}` : ""}`,
    );
    return 0;
  });
}

function remove(
  args: string[],
  projectConfig: string,
  options: cliTypes.McpCommandOptions,
  log: Line,
  error: Line,
): Promise<number> {
  const parsed = parseOptions(args, { local: "flag" }, error);
  if (parsed === undefined) return Promise.resolve(1);
  const [name, ...extra] = parsed.positional;
  if (name === undefined || name === "" || extra.length > 0) {
    error(`Usage: ${APP_NAME} mcp remove <server> [-l]\n${HELP_HINT}`);
    return Promise.resolve(1);
  }
  const project = parsed.values.has("local");
  const path = project ? projectConfig : join(options.agentDir, "mcp.json");
  const scope = project ? "project" : "global";
  return removeConfiguredServer({ error, log, name, options, path, scope });
}

const serverConfig = { add, projectConfigPath, remove };

export default serverConfig;
