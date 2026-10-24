import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import { dual } from "effect/Function";

import platform from "../../core/platform/index.ts";
import nodeOs from "../../core/platform/node/os.ts";
import resolveConfigValueModule from "../../core/resolve-config-value.ts";
import type configTypes from "./config.types.ts";

const { homedir } = nodeOs;

const { join, resolve } = platform;
const { resolveConfigValueOrThrow, resolveHeadersOrThrow } = resolveConfigValueModule;

const { StdioTransport, StreamableHttpTransport } = mcp;

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function createDefaultTransportImpl(
  entry: configTypes.McpServerEntry,
  cwd: string,
  authProvider: mcpTypes.AuthProvider | undefined,
): mcpTypes.McpTransport {
  const { config, name } = entry;
  if ("url" in config) {
    const headers = resolveHeadersOrThrow(config.headers, `MCP server "${name}"`);
    return new StreamableHttpTransport({
      url: config.url,
      ...(headers === undefined ? {} : { headers }),
      ...(authProvider === undefined ? {} : { authProvider }),
    });
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.env ?? {})) {
    env[key] = resolveConfigValueOrThrow(value, `MCP server "${name}" env "${key}"`);
  }
  return new StdioTransport({
    command: expandHome(config.command),
    ...(config.args === undefined ? {} : { args: config.args.map(expandHome) }),
    cwd: resolve(cwd, expandHome(config.cwd ?? ".")),
    env,
    stderr: "pipe",
  });
}

const createDefaultTransport: {
  (
    entry: configTypes.McpServerEntry,
    cwd: string,
    authProvider: mcpTypes.AuthProvider | undefined,
  ): mcpTypes.McpTransport;
  (
    cwd: string,
    authProvider: mcpTypes.AuthProvider | undefined,
  ): (entry: configTypes.McpServerEntry) => mcpTypes.McpTransport;
} = dual((args: IArguments) => args.length >= 3, createDefaultTransportImpl);

const transport = {
  createDefaultTransport,
  expandHome,
};

export default transport;
