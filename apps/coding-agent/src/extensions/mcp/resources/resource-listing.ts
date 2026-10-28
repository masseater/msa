import type aiTypes from "@msa/ai/index.types";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../../core/awaiting.ts";
import errorsModule from "../../../utils/errors.ts";
import type resourcesTypes from "../resources.types.ts";
import tools from "../tools.ts";
import type toolsTypes from "../tools.types.ts";

const { awaited, awaiting } = awaitingModule;
const { limitMcpContent } = tools;
const { toErrorMessage } = errorsModule;

type Server = resourcesTypes.McpResourceServer;
type Servers = () => readonly Server[];
type Item = { _meta?: unknown };
type Page<T> = (
  server: Server,
  cursor: string | undefined,
  options: mcpTypes.McpRequestOptions,
) => Promise<{ items: T[]; nextCursor?: string | undefined }>;
type All<T> = (server: Server, options: mcpTypes.McpRequestOptions) => Promise<T[]>;

function isMcpAppResource(item: {
  uri?: string;
  uriTemplate?: string;
  mimeType?: string;
}): boolean {
  const uri = item.uri ?? item.uriTemplate ?? "";
  return uri.startsWith("ui://") || /;\s*profile\s*=\s*"?mcp-app"?/iu.test(item.mimeType ?? "");
}

const visible = (item: Item) =>
  !isMcpAppResource(item as { uri?: string; uriTemplate?: string; mimeType?: string });

function listed<T extends Item>(server: string, item: T): Record<string, unknown> {
  const { _meta, icons: _icons, ...rest } = item as T & { icons?: unknown };
  return { server, ...rest };
}

function stringArgument(params: unknown, key: "cursor" | "server" | "uri"): string | undefined {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value.trim() || undefined;
}

function requestOptions(server: Server, signal: AbortSignal | undefined) {
  return { ...(signal === undefined ? {} : { signal }), timeoutMs: server.timeoutMs };
}

function findServer(servers: Servers, name: string): Server {
  const all = servers();
  const server = all.find((candidate) => candidate.name === name);
  if (server !== undefined) return server;
  const available = all.map((candidate) => candidate.name).join(", ");
  throw new Error(
    `MCP server "${name}" has no resources${available === "" ? "" : `. Servers with resources: ${available}`}`,
  );
}

function listPage<T extends Item>(
  server: Server,
  cursor: string | undefined,
  signal: AbortSignal | undefined,
  key: string,
  page: Page<T>,
): Promise<Record<string, unknown>> {
  return Effect.runPromise(
    awaiting(function* () {
      const result = yield* awaited(page(server, cursor, requestOptions(server, signal)));
      return {
        server: server.name,
        [key]: result.items.filter(visible).map((item) => listed(server.name, item)),
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
      };
    }),
  );
}

function listEveryServer<T extends Item>(
  servers: Servers,
  signal: AbortSignal | undefined,
  key: string,
  all: All<T>,
): Promise<Record<string, unknown>> {
  return Effect.runPromise(
    awaiting(function* () {
      const sorted = [...servers()].sort((a, b) => a.name.localeCompare(b.name));
      const results = yield* awaited(
        Promise.allSettled(sorted.map((server) => all(server, requestOptions(server, signal)))),
      );
      const items: Record<string, unknown>[] = [];
      const errors: { server: string; error: string }[] = [];
      results.forEach((result, index) => {
        const server = sorted[index]?.name;
        if (server === undefined) return;
        if (result.status === "fulfilled")
          items.push(...result.value.filter(visible).map((item) => listed(server, item)));
        else errors.push({ error: toErrorMessage(result.reason), server });
      });
      return { [key]: items, ...(errors.length > 0 ? { errors } : {}) };
    }),
  );
}

function list<T extends Item>(
  servers: Servers,
  params: unknown,
  signal: AbortSignal | undefined,
  source: { key: "resources" | "resourceTemplates"; page: Page<T>; all: All<T> },
): Promise<Record<string, unknown>> {
  return Effect.runPromise(
    awaiting(function* () {
      const serverName = stringArgument(params, "server");
      const cursor = stringArgument(params, "cursor");
      if (serverName !== undefined && serverName !== "") {
        const server = findServer(servers, serverName);
        return yield* awaited(listPage(server, cursor, signal, source.key, source.page));
      }
      if (cursor !== undefined && cursor !== "")
        throw new Error("cursor can only be used when a server is specified");
      return yield* awaited(listEveryServer(servers, signal, source.key, source.all));
    }),
  );
}

function jsonResult(
  tool: string,
  server: string | undefined,
  payload: Record<string, unknown>,
): Promise<{
  content: (aiTypes.TextContent | aiTypes.ImageContent)[];
  details: toolsTypes.McpToolDetails;
  structuredContent: aiTypes.JsonValue;
}> {
  return Effect.runPromise(
    awaiting(function* () {
      const { content, fullOutputPath } = yield* awaited(
        limitMcpContent([{ text: JSON.stringify(payload), type: "text" }]),
      );
      return {
        content,
        details: {
          server: server ?? "",
          tool,
          ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
        },
        structuredContent: payload as unknown as aiTypes.JsonValue,
      };
    }),
  );
}

function listTool(
  servers: Servers,
  name: string,
  source: Parameters<typeof list>[3],
): toolsTypes.McpToolDefinition["execute"] {
  return (_toolCallId, params, signal) =>
    Effect.runPromise(
      awaiting(function* () {
        const payload = yield* awaited(list(servers, params, signal, source));
        return yield* awaited(jsonResult(name, stringArgument(params, "server"), payload));
      }),
    );
}

const resourceListing = { findServer, listTool, requestOptions, stringArgument };

export default resourceListing;
