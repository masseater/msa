import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import mcpServers from "../../core/mcp-servers.ts";
import type configTypes from "./config.types.ts";
import resourcesPart1 from "./resources-part1.ts";
import type resourcesTypes from "./resources.types.ts";

const { awaited, awaiting } = awaitingModule;
const { LIST_MCP_RESOURCES_TOOL } = mcpServers;
const {
  createMcpResourceToolDefinitionsPart5,
  isMcpAppResource,
  jsonResult,
  listed,
  stringArgument,
} = resourcesPart1;

function createMcpResourceToolDefinitionsPart6(
  findServer: (name: string) => resourcesTypes.McpResourceServer,
  options: {
    exposure: configTypes.McpExposure;
    servers: () => readonly resourcesTypes.McpResourceServer[];
  },
) {
  return <T extends { _meta?: unknown }>(
    params: unknown,
    signal: AbortSignal | undefined,
    key: "resources" | "resourceTemplates",
    page: (
      server: resourcesTypes.McpResourceServer,
      cursor: string | undefined,
      options: mcpTypes.McpRequestOptions,
    ) => Promise<{
      items: T[];
      nextCursor?: string | undefined;
    }>,
    all: (
      server: resourcesTypes.McpResourceServer,
      options: mcpTypes.McpRequestOptions,
    ) => Promise<T[]>,
  ): Promise<Record<string, unknown>> =>
    Effect.runPromise(
      awaiting(function* () {
        const serverName = stringArgument(params, "server");
        const cursor = stringArgument(params, "cursor");
        const visible = (item: T) =>
          !isMcpAppResource(item as { uri?: string; uriTemplate?: string; mimeType?: string });
        if (serverName !== undefined && serverName !== "") {
          const server = findServer(serverName);
          return yield* createMcpResourceToolDefinitionsPart6Part1<T>(
            page,
            server,
            cursor,
            signal,
            key,
            visible,
          );
        }
        return yield* createMcpResourceToolDefinitionsPart5<T>(
          cursor,
          options,
          all,
          signal,
          visible,
          key,
        );
      }),
    );
}

function* createMcpResourceToolDefinitionsPart6Part1<T extends { _meta?: unknown }>(
  page: (
    server: resourcesTypes.McpResourceServer,
    cursor: string | undefined,
    options: mcpTypes.McpRequestOptions,
  ) => Promise<{
    items: T[];
    nextCursor?: string | undefined;
  }>,
  server: resourcesTypes.McpResourceServer,
  cursor: string | undefined,
  signal: AbortSignal | undefined,
  key: string,
  visible: (item: T) => boolean,
) {
  const result = yield* awaited(
    page(server, cursor, {
      ...(signal === undefined ? {} : { signal }),
      timeoutMs: server.timeoutMs,
    }),
  );
  return {
    server: server.name,
    [key]: result.items.filter(visible).map((item) => listed(server.name, item)),
    ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
  };
}

function* createMcpResourceToolDefinitionsPart3Part1(
  list: <T extends { _meta?: unknown }>(
    params: unknown,
    signal: AbortSignal | undefined,
    key: "resources" | "resourceTemplates",
    page: (
      server: resourcesTypes.McpResourceServer,
      cursor: string | undefined,
      options: mcpTypes.McpRequestOptions,
    ) => Promise<{
      items: T[];
      nextCursor?: string | undefined;
    }>,
    all: (
      server: resourcesTypes.McpResourceServer,
      options: mcpTypes.McpRequestOptions,
    ) => Promise<T[]>,
  ) => Promise<Record<string, unknown>>,
  params: unknown,
  signal: AbortSignal | undefined,
) {
  const payload = yield* awaited(
    list(
      params,
      signal,
      "resources",
      (server, cursor, requestOptions) =>
        Effect.runPromise(
          awaiting(function* () {
            const result = yield* awaited(server.resourcesPage(cursor, requestOptions));
            return { items: result.resources, nextCursor: result.nextCursor };
          }),
        ),
      (server, requestOptions) => server.allResources(requestOptions),
    ),
  );
  return yield* awaited(
    jsonResult(LIST_MCP_RESOURCES_TOOL, stringArgument(params, "server"), payload),
  );
}

function* createMcpResourceToolDefinitionsPart2Part1(
  list: <T extends { _meta?: unknown }>(
    params: unknown,
    signal: AbortSignal | undefined,
    key: "resources" | "resourceTemplates",
    page: (
      server: resourcesTypes.McpResourceServer,
      cursor: string | undefined,
      options: mcpTypes.McpRequestOptions,
    ) => Promise<{
      items: T[];
      nextCursor?: string | undefined;
    }>,
    all: (
      server: resourcesTypes.McpResourceServer,
      options: mcpTypes.McpRequestOptions,
    ) => Promise<T[]>,
  ) => Promise<Record<string, unknown>>,
  params: unknown,
  signal: AbortSignal | undefined,
) {
  return yield* awaited(
    list(
      params,
      signal,
      "resourceTemplates",
      (server, cursor, requestOptions) =>
        Effect.runPromise(
          awaiting(function* () {
            const result = yield* awaited(server.resourceTemplatesPage(cursor, requestOptions));
            return { items: result.resourceTemplates, nextCursor: result.nextCursor };
          }),
        ),
      (server, requestOptions) => server.allResourceTemplates(requestOptions),
    ),
  );
}

const resourcesPart2 = {
  createMcpResourceToolDefinitionsPart2Part1,
  createMcpResourceToolDefinitionsPart3Part1,
  createMcpResourceToolDefinitionsPart6,
};

export default resourcesPart2;
