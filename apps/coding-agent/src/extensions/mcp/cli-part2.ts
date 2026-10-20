import configModule from "../../config.ts";
import mcpServers from "../../core/mcp-servers.ts";
import type mcpServersTypes from "../../core/mcp-servers.types.ts";
import platformNode from "../../core/platform-node.ts";
import ProjectTrustStore from "../../core/project-trust-store.ts";
import errorsModule from "../../utils/errors.ts";
import cliPart1 from "./cli-part1.ts";
import type cliTypes from "./cli.types.ts";
import mcpConfig from "./config.ts";

const { APP_NAME } = configModule;
const { validateMcpServerConfig } = mcpServers;
const { join } = platformNode;
const { addMcpServerConfig, loadMcpConfig, removeMcpServerConfig } = mcpConfig;
const { toErrorMessage } = errorsModule;
const { HELP_HINT, addPart1, addPart2, parseOptions, parsePairs } = cliPart1;

function add(
  args: string[],
  projectConfig: string,
  options: cliTypes.McpCommandOptions,
  log: (line: string) => void,
  error: (line: string) => void,
): number {
  const { parsed, usage } = addPart1(args, error);
  if (parsed === undefined) return 1;
  const { positional, values, lists } = parsed;
  const [name, ...command] = positional;
  const url = values.get("url");
  if (name === undefined || name === "" || (url === undefined) === (command.length === 0)) {
    error(usage);
    return 1;
  }
  const { misplaced, value, exposure } = addPart2(values, url, lists);
  if (misplaced !== undefined && misplaced !== "") {
    error(
      `--${misplaced} only applies to ${url === undefined ? "HTTP servers (--url)" : "stdio servers"}.`,
    );
    return 1;
  }

  let config: Record<string, unknown>;
  if (typeof url === "string") {
    const headers = parsePairs("header", lists.get("header"), error);
    if (headers === undefined) return 1;
    const oauth = addPart4(value, headers);
    config = {
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(Object.keys(oauth).length > 0 ? { oauth } : {}),
    };
  } else {
    const env = parsePairs("env", lists.get("env"), error);
    if (env === undefined) return 1;
    const [executable, ...commandArgs] = command;
    config = {
      command: executable,
      ...(commandArgs.length > 0 ? { args: commandArgs } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(value("cwd") === undefined ? {} : { cwd: value("cwd") }),
    };
  }
  if (exposure !== undefined) config["exposure"] = exposure;
  const description = value("description");
  if (description !== undefined) config["description"] = description;
  const validated = validateMcpServerConfig(name, config);
  if (typeof validated === "string") {
    error(validated);
    return 1;
  }

  const project = values.has("local");
  const path = project ? projectConfig : join(options.agentDir, "mcp.json");
  const scope = project ? "project" : "global";
  let replaced: boolean;
  try {
    replaced = addMcpServerConfig(path, name, validated);
  } catch (addError) {
    error(`Could not update ${path}: ${toErrorMessage(addError)}`);
    return 1;
  }
  return addPart3(log, replaced, scope, name, path, project, options, validated);
}

function addPart4(value: (option: string) => string | undefined, headers: Record<string, string>) {
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
  return oauth;
}

function addPart3(
  log: (line: string) => void,
  replaced: boolean,
  scope: string,
  name: string,
  path: string,
  project: boolean,
  options: cliTypes.McpCommandOptions,
  validated: mcpServersTypes.McpServerConfig,
): number {
  log(`${replaced ? "Replaced" : "Added"} ${scope} MCP server "${name}" in ${path}.`);
  if (project && new ProjectTrustStore(options.agentDir).get(options.cwd) !== true) {
    log(
      `The project is not trusted, so ${path} is ignored until you start ${APP_NAME} in the project and trust it.`,
    );
  }

  const mayNeedSignIn =
    "url" in validated &&
    !Object.keys(validated.headers ?? {}).some(
      (header) => header.toLowerCase() === "authorization",
    );
  log(
    `Check it with: ${APP_NAME} mcp list${mayNeedSignIn ? `. If it requires sign-in: ${APP_NAME} mcp login ${name}` : ""}`,
  );
  return 0;
}

function remove(
  args: string[],
  projectConfig: string,
  options: cliTypes.McpCommandOptions,
  log: (line: string) => void,
  error: (line: string) => void,
): number {
  const parsed = parseOptions(args, { local: "flag" }, error);
  if (parsed === undefined) return 1;
  const [name, ...extra] = parsed.positional;
  if (name === undefined || name === "" || extra.length > 0) {
    error(`Usage: ${APP_NAME} mcp remove <server> [-l]\n${HELP_HINT}`);
    return 1;
  }
  const project = parsed.values.has("local");
  const globalConfig = join(options.agentDir, "mcp.json");
  const path = project ? projectConfig : globalConfig;
  const scope = project ? "project" : "global";
  let removed: boolean;
  try {
    removed = removeMcpServerConfig(path, name);
  } catch (removeError) {
    error(`Could not update ${path}: ${toErrorMessage(removeError)}`);
    return 1;
  }
  if (removed) {
    log(`Removed ${scope} MCP server "${name}" from ${path}.`);
    return 0;
  }
  const other = loadMcpConfig({
    agentDir: options.agentDir,
    cwd: options.cwd,
    projectTrusted: true,
  }).servers.find((server) => server.name === name && server.scope !== scope);
  error(
    `No ${scope} MCP server named "${name}" in ${path}.${other === undefined ? "" : ` It is defined in ${other.source}${other.scope === "project" ? "; use --local" : "; omit --local"}.`}`,
  );
  return 1;
}

const cliPart2 = {
  add,
  remove,
};

export default cliPart2;
