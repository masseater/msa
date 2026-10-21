import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type configTypes from "./config.types.ts";

const { JSON_RPC_ERROR_CODES, McpError, McpHttpError } = mcp;
const { awaited, awaiting } = awaitingModule;

const DEFAULT_TIMEOUT_SECONDS = 60;

const STDERR_TAIL_CHARS = 2_000;

const CONNECT_RETRY_DELAYS_MS = [250, 1_000];

function isTransientError(error: unknown): boolean {
  if (error instanceof McpHttpError) {
    return (
      error.status === 408 || error.status === 429 || (error.status >= 500 && error.status !== 501)
    );
  }
  return error instanceof TypeError;
}

function signInRequiredMessage(entry: configTypes.McpServerEntry): string {
  const provider = "url" in entry.config ? entry.config.auth?.provider : undefined;
  return `MCP server "${entry.name}" requires sign-in. Run ${provider !== undefined && provider !== "" ? `/login ${provider}` : "/mcp"} to sign in.`;
}

function usesOAuth(entry: configTypes.McpServerEntry): boolean {
  const { config } = entry;
  if (!("url" in config) || config.auth !== undefined) return false;
  return !Object.keys(config.headers ?? {}).some(
    (header) => header.toLowerCase() === "authorization",
  );
}

function withoutTemplates<T>(list: () => Promise<T>, empty: T): Promise<T> {
  return Effect.runPromise(
    awaiting(function* () {
      try {
        return yield* awaited(list());
      } catch (error) {
        if (error instanceof McpError && error.code === JSON_RPC_ERROR_CODES.methodNotFound)
          return empty;
        throw error;
      }
    }),
  );
}

function listTemplates(
  client: mcpTypes.McpClient,
  options: mcpTypes.McpRequestOptions = {},
): Promise<mcpTypes.ResourceTemplate[]> {
  return withoutTemplates(() => client.listResourceTemplates(options), []);
}

const mcpServerConnectionHelpers = {
  CONNECT_RETRY_DELAYS_MS,
  DEFAULT_TIMEOUT_SECONDS,
  STDERR_TAIL_CHARS,
  isTransientError,
  listTemplates,
  signInRequiredMessage,
  usesOAuth,
  withoutTemplates,
};

export default mcpServerConnectionHelpers;
