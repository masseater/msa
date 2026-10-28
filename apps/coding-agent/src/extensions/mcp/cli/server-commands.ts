import * as Effect from "effect/Effect";

import configModule from "../../../config.ts";
import awaitingModule from "../../../core/awaiting.ts";
import memoryModule from "../../../core/memory/memory.ts";
import type cliInternalTypes from "../cli-internal.types.ts";
import type configTypes from "../config.types.ts";
import cliOptions from "./cli-options.ts";
import listServers from "./list-servers.ts";
import loginModule from "./login.ts";
import serverConnection from "./server-connection.ts";

const { APP_NAME } = configModule;
const { awaited, awaiting } = awaitingModule;
const { HELP_HINT, parseOptions } = cliOptions;
const { list } = listServers;
const { login } = loginModule;
const { createConnection } = serverConnection;
const { notAnMcpServer } = memoryModule;

const DEFAULT_LOGIN_TIMEOUT_SECONDS = 300;

type CommandContext = cliInternalTypes.CommandContext;

function listCommand(rest: string[], context: CommandContext): Promise<number> {
  const { error } = context;
  const parsed = parseOptions(rest, { json: "flag" }, error);
  if (parsed === undefined) return Promise.resolve(1);
  if (parsed.positional.length > 0) {
    error(`Usage: ${APP_NAME} mcp list [--json]\n${HELP_HINT}`);
    return Promise.resolve(1);
  }
  const { loaded, untrustedNote, options, credentials, log } = context;
  return list(loaded, parsed.values.has("json"), untrustedNote, options, credentials, log);
}

function findEntry(name: string, context: CommandContext): configTypes.McpServerEntry | undefined {
  const { loaded, untrustedNote } = context;
  const entry = loaded.servers.find((server) => server.name === name);
  if (entry !== undefined) return entry;
  const memoryHint = notAnMcpServer(name);
  if (memoryHint !== undefined) {
    context.error(memoryHint);
    return undefined;
  }
  context.error(
    `No MCP server named "${name}".${untrustedNote !== undefined && untrustedNote !== "" ? ` ${untrustedNote}` : ""} Configured: ${loaded.servers.map((server) => server.name).join(", ") || "none"}.`,
  );
  return undefined;
}

function loginOrLogout(
  command: "login" | "logout",
  rest: string[],
  context: CommandContext,
): Promise<number> {
  return Effect.runPromise(
    awaiting(function* () {
      const { options, credentials, log, error } = context;
      const parsed = parseOptions(rest, command === "login" ? { timeout: "value" } : {}, error);
      if (parsed === undefined) return 1;
      const [name, ...extra] = parsed.positional;
      if (name === undefined || name === "" || extra.length > 0) {
        error(`Usage: ${APP_NAME} mcp ${command} <server>\n${HELP_HINT}`);
        return 1;
      }
      const entry = findEntry(name, context);
      if (entry === undefined) return 1;
      const connection = createConnection(entry, options, credentials);
      const url = connection.auth.oauthUrl;
      if (url === undefined || url === "") {
        error(
          `MCP server "${name}" does not use OAuth. Only HTTP servers without an Authorization header do.`,
        );
        return 1;
      }
      if (command === "logout") {
        const removed = yield* awaited(credentials.remove(name, url));
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
    }),
  );
}

const serverCommands = { listCommand, loginOrLogout };

export default serverCommands;
