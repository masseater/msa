import { homedir } from "node:os";

import {
  type AuthProvider,
  type McpTransport,
  StdioTransport,
  StreamableHttpTransport,
} from "@msa/mcp";
import { dual } from "effect/Function";

import { join, resolve } from "../../core/platform-node.ts";
import {
  resolveConfigValueOrThrow,
  resolveHeadersOrThrow,
} from "../../core/resolve-config-value.ts";
import type { McpServerEntry } from "./config.ts";

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function createDefaultTransportImpl(
  entry: McpServerEntry,
  cwd: string,
  authProvider: AuthProvider | undefined,
): McpTransport {
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

export const createDefaultTransport: {
  (entry: McpServerEntry, cwd: string, authProvider: AuthProvider | undefined): McpTransport;
  (cwd: string, authProvider: AuthProvider | undefined): (entry: McpServerEntry) => McpTransport;
} = dual((args: IArguments) => args.length >= 3, createDefaultTransportImpl);
