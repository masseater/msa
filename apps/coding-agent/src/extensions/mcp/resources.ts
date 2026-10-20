import type aiTypes from "@msa/ai/index.types";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";
import type { TSchema } from "typebox";

import { awaited, awaiting } from "../../core/awaiting.ts";
import type { ToolAnnotations, ToolDefinition } from "../../core/extensions/types.ts";
import {
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
} from "../../core/mcp-servers.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import type { McpExposure } from "./config.ts";
import { type McpToolDetails, limitMcpContent, toModelContent, toToolExposure } from "./tools.ts";

export { LIST_MCP_RESOURCE_TEMPLATES_TOOL, LIST_MCP_RESOURCES_TOOL, READ_MCP_RESOURCE_TOOL };

export interface McpResourceServer {
  name: string;
  timeoutMs: number;
  resourcesPage(
    cursor: string | undefined,
    options: mcpTypes.McpRequestOptions,
  ): Promise<mcpTypes.ListResourcesResult>;
  resourceTemplatesPage(
    cursor: string | undefined,
    options: mcpTypes.McpRequestOptions,
  ): Promise<mcpTypes.ListResourceTemplatesResult>;
  allResources(options: mcpTypes.McpRequestOptions): Promise<mcpTypes.Resource[]>;
  allResourceTemplates(options: mcpTypes.McpRequestOptions): Promise<mcpTypes.ResourceTemplate[]>;
  readResource(
    uri: string,
    options: mcpTypes.McpRequestOptions,
  ): Promise<mcpTypes.ReadResourceResult>;
}

function isMcpAppResource(item: {
  uri?: string;
  uriTemplate?: string;
  mimeType?: string;
}): boolean {
  const uri = item.uri ?? item.uriTemplate ?? "";
  return uri.startsWith("ui://") || /;\s*profile\s*=\s*"?mcp-app"?/iu.test(item.mimeType ?? "");
}

function listed<T extends { _meta?: unknown }>(server: string, item: T): Record<string, unknown> {
  const { _meta, icons: _icons, ...rest } = item as T & { icons?: unknown };
  return { server, ...rest };
}

const stringProperty = (description: string) => ({ description, type: "string" });
const SERVER_FILTER = stringProperty("MCP server name. Omit to list every server with resources.");
const CURSOR = stringProperty(
  "Opaque cursor from a previous call with the same server; omit for the first page.",
);
const LIST_PARAMETERS = {
  additionalProperties: false,
  properties: { cursor: CURSOR, server: SERVER_FILTER },
  type: "object",
};
const READ_PARAMETERS = {
  additionalProperties: false,
  properties: {
    server: stringProperty(
      "MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources.",
    ),
    uri: stringProperty(
      "Resource URI to read. Must be one of the URIs returned by list_mcp_resources.",
    ),
  },
  required: ["server", "uri"],
  type: "object",
};

const optionalString = { type: "string" };
const LISTING_ERRORS = {
  description: "Servers that could not be listed",
  items: {
    properties: { error: { type: "string" }, server: { type: "string" } },
    required: ["server", "error"],
    type: "object",
  },
  type: "array",
};
const LIST_OUTPUT_SCHEMA = {
  properties: {
    errors: LISTING_ERRORS,
    nextCursor: optionalString,
    resources: {
      items: {
        properties: {
          description: optionalString,
          mimeType: optionalString,
          name: { type: "string" },
          server: { type: "string" },
          size: { type: "number" },
          title: optionalString,
          uri: { type: "string" },
        },
        required: ["server", "uri", "name"],
        type: "object",
      },
      type: "array",
    },
    server: optionalString,
  },
  required: ["resources"],
  type: "object",
};
const LIST_TEMPLATES_OUTPUT_SCHEMA = {
  properties: {
    errors: LISTING_ERRORS,
    nextCursor: optionalString,
    resourceTemplates: {
      items: {
        properties: {
          description: optionalString,
          mimeType: optionalString,
          name: { type: "string" },
          server: { type: "string" },
          title: optionalString,
          uriTemplate: { description: "RFC 6570 URI template", type: "string" },
        },
        required: ["server", "uriTemplate", "name"],
        type: "object",
      },
      type: "array",
    },
    server: optionalString,
  },
  required: ["resourceTemplates"],
  type: "object",
};
const READ_OUTPUT_SCHEMA = {
  properties: {
    contents: {
      items: {
        anyOf: [
          {
            type: "object",
            properties: {
              uri: { type: "string" },
              mimeType: optionalString,
              text: { type: "string" },
            },
            required: ["uri", "text"],
          },
          {
            type: "object",
            properties: {
              uri: { type: "string" },
              mimeType: optionalString,
              blob: { type: "string", description: "base64" },
            },
            required: ["uri", "blob"],
          },
        ],
      },
      type: "array",
    },
    server: { type: "string" },
    uri: { type: "string" },
  },
  required: ["server", "uri", "contents"],
  type: "object",
};

function stringArgument(params: unknown, key: string): string | undefined {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value.trim() || undefined;
}

function jsonResult(
  tool: string,
  server: string | undefined,
  payload: Record<string, unknown>,
): Promise<{
  content: (aiTypes.TextContent | aiTypes.ImageContent)[];
  details: McpToolDetails;
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

export function createMcpResourceToolDefinitions(options: {
  exposure: McpExposure;
  servers: () => readonly McpResourceServer[];
}): ToolDefinition<TSchema, McpToolDetails>[] {
  const readOnly: ToolAnnotations = { readOnlyHint: true };

  const findServer = (name: string): McpResourceServer => {
    const servers = options.servers();
    const server = servers.find((candidate) => candidate.name === name);
    if (server !== undefined) return server;
    const available = servers.map((candidate) => candidate.name).join(", ");
    throw new Error(
      `MCP server "${name}" has no resources${available === "" ? "" : `. Servers with resources: ${available}`}`,
    );
  };

  const list = <T extends { _meta?: unknown }>(
    params: unknown,
    signal: AbortSignal | undefined,
    key: "resources" | "resourceTemplates",
    page: (
      server: McpResourceServer,
      cursor: string | undefined,
      options: mcpTypes.McpRequestOptions,
    ) => Promise<{
      items: T[];
      nextCursor?: string | undefined;
    }>,
    all: (server: McpResourceServer, options: mcpTypes.McpRequestOptions) => Promise<T[]>,
  ): Promise<Record<string, unknown>> =>
    Effect.runPromise(
      awaiting(function* () {
        const serverName = stringArgument(params, "server");
        const cursor = stringArgument(params, "cursor");
        const visible = (item: T) =>
          !isMcpAppResource(item as { uri?: string; uriTemplate?: string; mimeType?: string });
        if (serverName !== undefined && serverName !== "") {
          const server = findServer(serverName);
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
        if (cursor !== undefined && cursor !== "")
          throw new Error("cursor can only be used when a server is specified");
        const servers = [...options.servers()].sort((a, b) => a.name.localeCompare(b.name));
        const results = yield* awaited(
          Promise.allSettled(
            servers.map((server) =>
              all(server, {
                ...(signal === undefined ? {} : { signal }),
                timeoutMs: server.timeoutMs,
              }),
            ),
          ),
        );
        const items: Record<string, unknown>[] = [];
        const errors: { server: string; error: string }[] = [];
        results.forEach((result, index) => {
          const server = servers[index]?.name;
          if (server === undefined) return;
          if (result.status === "fulfilled")
            items.push(...result.value.filter(visible).map((item) => listed(server, item)));
          else errors.push({ error: toErrorMessage(result.reason), server });
        });
        return { [key]: items, ...(errors.length > 0 ? { errors } : {}) };
      }),
    );

  const listResources: ToolDefinition<TSchema, McpToolDetails> = {
    annotations: readOnly,
    description:
      "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.",
    execute(_toolCallId, params, signal) {
      return Effect.runPromise(
        awaiting(function* () {
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
        }),
      );
    },
    exposure: toToolExposure(options.exposure),
    label: LIST_MCP_RESOURCES_TOOL,
    name: LIST_MCP_RESOURCES_TOOL,
    outputSchema: LIST_OUTPUT_SCHEMA as unknown as TSchema,
    parameters: LIST_PARAMETERS as unknown as TSchema,
  };

  const listTemplates: ToolDefinition<TSchema, McpToolDetails> = {
    annotations: readOnly,
    description:
      "Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.",
    execute(_toolCallId, params, signal) {
      return Effect.runPromise(
        awaiting(function* () {
          const payload = yield* awaited(
            list(
              params,
              signal,
              "resourceTemplates",
              (server, cursor, requestOptions) =>
                Effect.runPromise(
                  awaiting(function* () {
                    const result = yield* awaited(
                      server.resourceTemplatesPage(cursor, requestOptions),
                    );
                    return { items: result.resourceTemplates, nextCursor: result.nextCursor };
                  }),
                ),
              (server, requestOptions) => server.allResourceTemplates(requestOptions),
            ),
          );
          return yield* awaited(
            jsonResult(LIST_MCP_RESOURCE_TEMPLATES_TOOL, stringArgument(params, "server"), payload),
          );
        }),
      );
    },
    exposure: toToolExposure(options.exposure),
    label: LIST_MCP_RESOURCE_TEMPLATES_TOOL,
    name: LIST_MCP_RESOURCE_TEMPLATES_TOOL,
    outputSchema: LIST_TEMPLATES_OUTPUT_SCHEMA as unknown as TSchema,
    parameters: LIST_PARAMETERS as unknown as TSchema,
  };

  const readResource: ToolDefinition<TSchema, McpToolDetails> = {
    annotations: readOnly,
    description:
      "Read a specific resource from an MCP server given the server name and resource URI.",
    execute(_toolCallId, params, signal) {
      return Effect.runPromise(
        awaiting(function* () {
          const serverName = stringArgument(params, "server");
          const uri = stringArgument(params, "uri");
          if (serverName === undefined || serverName === "")
            throw new Error("server must be provided");
          if (uri === undefined || uri === "") throw new Error("uri must be provided");
          const server = findServer(serverName);
          const result = yield* awaited(
            server.readResource(uri, {
              ...(signal === undefined ? {} : { signal }),
              timeoutMs: server.timeoutMs,
            }),
          );

          const blocks: mcpTypes.ContentBlock[] = result.contents.flatMap((contents) => [
            ...(result.contents.length > 1
              ? [{ type: "text" as const, text: `${contents.uri}:` }]
              : []),
            { type: "resource" as const, resource: contents },
          ]);
          const converted = yield* awaited(toModelContent(server.name, blocks));
          const { content, fullOutputPath } = yield* awaited(
            limitMcpContent(
              converted.length > 0
                ? converted
                : [{ type: "text", text: `Resource ${uri} is empty.` }],
            ),
          );
          const contents = result.contents.map(({ _meta: _ignored, ...rest }) => rest);
          return {
            content,
            details: {
              server: server.name,
              tool: READ_MCP_RESOURCE_TOOL,
              ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
            },
            structuredContent: {
              server: server.name,
              uri,
              contents,
            } as unknown as aiTypes.JsonValue,
          };
        }),
      );
    },
    exposure: toToolExposure(options.exposure),
    label: READ_MCP_RESOURCE_TOOL,
    name: READ_MCP_RESOURCE_TOOL,
    outputSchema: READ_OUTPUT_SCHEMA as unknown as TSchema,
    parameters: READ_PARAMETERS as unknown as TSchema,
  };

  return [listResources, listTemplates, readResource];
}
