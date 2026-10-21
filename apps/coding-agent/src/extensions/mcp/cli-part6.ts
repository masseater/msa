import * as Effect from "effect/Effect";

import configModule from "../../config.ts";
import awaitingModule from "../../core/awaiting.ts";
import platformNode from "../../core/platform-node.ts";
import platform from "../../core/platform.ts";
import ProjectTrustStore from "../../core/project-trust-store.ts";
import nodeFs from "../../utils/node-fs.ts";
import cliPart1 from "./cli-part1.ts";
import cliPart2 from "./cli-part2.ts";
import cliPart3 from "./cli-part3.ts";
import cliPart5 from "./cli-part5.ts";
import type cliTypes from "./cli.types.ts";
import mcpConfig from "./config.ts";
import runtime from "./runtime.ts";

const { awaited, awaiting } = awaitingModule;
const { writeError, writeLog } = platform;
const { join } = platformNode;
const { APP_NAME, CONFIG_DIR_NAME } = configModule;
const { loadMcpConfig } = mcpConfig;
const { exists } = nodeFs;
const { McpOAuthCredentialStore } = runtime;
const { DEFAULT_LOGIN_TIMEOUT_SECONDS, HELP, HELP_HINT, createConnection, parseOptions } = cliPart1;
const { add, remove } = cliPart2;
const { list } = cliPart3;
const { login } = cliPart5;

function runMcpCommandImpl(args: string[], options: cliTypes.McpCommandOptions): Promise<number> {
  return Effect.runPromise(
    awaiting(function* () {
      const log = options.log ?? ((line: string) => writeLog(line));
      const error = options.error ?? ((line: string) => writeError(line));
      const [command, ...rest] = args;
      if (
        command === undefined ||
        command === "help" ||
        args.includes("--help") ||
        args.includes("-h")
      ) {
        log(HELP);
        return 0;
      }

      const projectConfig = join(options.cwd, CONFIG_DIR_NAME, "mcp.json");
      if (command === "add" || command === "remove") {
        return command === "add"
          ? add(rest, projectConfig, options, log, error)
          : remove(rest, projectConfig, options, log, error);
      }
      const { loaded, untrustedNote, credentials } = yield* runMcpCommandImplPart1(
        options,
        projectConfig,
      );

      switch (command) {
        case "list": {
          const parsed = parseOptions(rest, { json: "flag" }, error);
          if (parsed === undefined) return 1;
          if (parsed.positional.length > 0) {
            error(`Usage: ${APP_NAME} mcp list [--json]\n${HELP_HINT}`);
            return 1;
          }
          return yield* awaited(
            list(loaded, parsed.values.has("json"), untrustedNote, options, credentials, log),
          );
        }
        case "login":
        case "logout": {
          const parsed = parseOptions(rest, command === "login" ? { timeout: "value" } : {}, error);
          if (parsed === undefined) return 1;
          const [name, ...extra] = parsed.positional;
          if (name === undefined || name === "" || extra.length > 0) {
            error(`Usage: ${APP_NAME} mcp ${command} <server>\n${HELP_HINT}`);
            return 1;
          }
          const entry = loaded.servers.find((server) => server.name === name);
          if (entry === undefined) {
            error(
              `No MCP server named "${name}".${untrustedNote !== undefined && untrustedNote !== "" ? ` ${untrustedNote}` : ""} Configured: ${loaded.servers.map((server) => server.name).join(", ") || "none"}.`,
            );
            return 1;
          }
          const connection = createConnection(entry, options, credentials);
          const url = connection.auth.oauthUrl;
          if (url === undefined || url === "") {
            error(
              `MCP server "${name}" does not use OAuth. Only HTTP servers without an Authorization header do.`,
            );
            return 1;
          }
          if (command === "logout") {
            const removed = credentials.remove(name, url);
            log(
              removed
                ? `Signed out of MCP server "${name}".`
                : `No stored credentials for MCP server "${name}".`,
            );
            return 0;
          }
          const timeout = Number(parsed.values.get("timeout") ?? DEFAULT_LOGIN_TIMEOUT_SECONDS);
          if (!Number.isFinite(timeout) || timeout <= 0) {
            error("--timeout must be a positive number of seconds.");
            return 1;
          }
          try {
            return yield* awaited(
              login(entry, connection, url, timeout * 1000, options, credentials, log, error),
            );
          } finally {
            yield* awaited(connection.close());
          }
        }
        default:
          error(`Unknown mcp command "${command}".\n${HELP_HINT}`);
          return 1;
      }
    }),
  );
}

const cliPart6 = {
  runMcpCommandImpl,
};

export default cliPart6;

function* runMcpCommandImplPart1(options: cliTypes.McpCommandOptions, projectConfig: string) {
  const projectTrusted = new ProjectTrustStore(options.agentDir).get(options.cwd) === true;
  const loaded = loadMcpConfig({
    agentDir: options.agentDir,
    cwd: options.cwd,
    projectTrusted,
  });
  const untrustedNote =
    !projectTrusted && (yield* awaited(exists(projectConfig)))
      ? `${projectConfig} is ignored because the project is not trusted. Start ${APP_NAME} in the project to trust it.`
      : undefined;
  const credentials = options.credentials ?? new McpOAuthCredentialStore();
  return { credentials, loaded, untrustedNote };
}
