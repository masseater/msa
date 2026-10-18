import type { ImageContent, JsonValue, TextContent } from "@msa/ai";
import type {
  ContentBlock,
  ListResourcesResult,
  ListResourceTemplatesResult,
  McpRequestOptions,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
} from "@msa/mcp";
import type { TSchema } from "typebox";

import type { ToolAnnotations, ToolDefinition } from "../../core/extensions/types.ts";
import {
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  LIST_MCP_RESOURCES_TOOL,
  READ_MCP_RESOURCE_TOOL,
} from "../../core/mcp-servers.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import type { McpExposure } from "./config.ts";
import { limitMcpContent, type McpToolDetails, toModelContent, toToolExposure } from "./tools.ts";

export { LIST_MCP_RESOURCE_TEMPLATES_TOOL, LIST_MCP_RESOURCES_TOOL, READ_MCP_RESOURCE_TOOL };

export interface McpResourceServer {
  name: string;
  timeoutMs: number;
  resourcesPage(
    cursor: string | undefined,
    options: McpRequestOptions,
  ): Promise<ListResourcesResult>;
  resourceTemplatesPage(
    cursor: string | undefined,
    options: McpRequestOptions,
  ): Promise<ListResourceTemplatesResult>;
  allResources(options: McpRequestOptions): Promise<Resource[]>;
  allResourceTemplates(options: McpRequestOptions): Promise<ResourceTemplate[]>;
  readResource(uri: string, options: McpRequestOptions): Promise<ReadResourceResult>;
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

const stringProperty = (description: string) => ({ type: "string", description });
const SERVER_FILTER = stringProperty("MCP server name. Omit to list every server with resources.");
const CURSOR = stringProperty(
  "Opaque cursor from a previous call with the same server; omit for the first page.",
);
const LIST_PARAMETERS = {
  type: "object",
  properties: { server: SERVER_FILTER, cursor: CURSOR },
  additionalProperties: false,
};
const READ_PARAMETERS = {
  type: "object",
  properties: {
    server: stringProperty(
      "MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources.",
    ),
    uri: stringProperty(
      "Resource URI to read. Must be one of the URIs returned by list_mcp_resources.",
    ),
  },
  required: ["server", "uri"],
  additionalProperties: false,
};

const optionalString = { type: "string" };
const LISTING_ERRORS = {
  type: "array",
  description: "Servers that could not be listed",
  items: {
    type: "object",
    properties: { server: { type: "string" }, error: { type: "string" } },
    required: ["server", "error"],
  },
};
const LIST_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    server: optionalString,
    resources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          server: { type: "string" },
          uri: { type: "string" },
          name: { type: "string" },
          title: optionalString,
          description: optionalString,
          mimeType: optionalString,
          size: { type: "number" },
        },
        required: ["server", "uri", "name"],
      },
    },
    nextCursor: optionalString,
    errors: LISTING_ERRORS,
  },
  required: ["resources"],
};
const LIST_TEMPLATES_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    server: optionalString,
    resourceTemplates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          server: { type: "string" },
          uriTemplate: { type: "string", description: "RFC 6570 URI template" },
          name: { type: "string" },
          title: optionalString,
          description: optionalString,
          mimeType: optionalString,
        },
        required: ["server", "uriTemplate", "name"],
      },
    },
    nextCursor: optionalString,
    errors: LISTING_ERRORS,
  },
  required: ["resourceTemplates"],
};
const READ_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    server: { type: "string" },
    uri: { type: "string" },
    contents: {
      type: "array",
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
    },
  },
  required: ["server", "uri", "contents"],
};

function stringArgument(params: unknown, key: string): string | undefined {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value.trim() || undefined;
}

async function jsonResult(
  tool: string,
  server: string | undefined,
  payload: Record<string, unknown>,
): Promise<{
  content: (TextContent | ImageContent)[];
  details: McpToolDetails;
  structuredContent: JsonValue;
}> {
  const { content, fullOutputPath } = await limitMcpContent([
    { type: "text", text: JSON.stringify(payload) },
  ]);
  return {
    content,
    details: {
      server: server ?? "",
      tool,
      ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
    },
    structuredContent: payload as unknown as JsonValue,
  };
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

  const list = async <T extends { _meta?: unknown }>(
    params: unknown,
    signal: AbortSignal | undefined,
    key: "resources" | "resourceTemplates",
    page: (
      server: McpResourceServer,
      cursor: string | undefined,
      options: McpRequestOptions,
    ) => Promise<{
      items: T[];
      nextCursor?: string | undefined;
    }>,
    all: (server: McpResourceServer, options: McpRequestOptions) => Promise<T[]>,
  ): Promise<Record<string, unknown>> => {
    const serverName = stringArgument(params, "server");
    const cursor = stringArgument(params, "cursor");
    const visible = (item: T) =>
      !isMcpAppResource(item as { uri?: string; uriTemplate?: string; mimeType?: string });
    if (serverName !== undefined && serverName !== "") {
      const server = findServer(serverName);
      const result = await page(server, cursor, {
        ...(signal === undefined ? {} : { signal }),
        timeoutMs: server.timeoutMs,
      });
      return {
        server: server.name,
        [key]: result.items.filter(visible).map((item) => listed(server.name, item)),
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
      };
    }
    if (cursor !== undefined && cursor !== "")
      throw new Error("cursor can only be used when a server is specified");
    const servers = [...options.servers()].sort((a, b) => a.name.localeCompare(b.name));
    const results = await Promise.allSettled(
      servers.map((server) =>
        all(server, { ...(signal === undefined ? {} : { signal }), timeoutMs: server.timeoutMs }),
      ),
    );
    const items: Record<string, unknown>[] = [];
    const errors: { server: string; error: string }[] = [];
    results.forEach((result, index) => {
      const server = servers[index]?.name;
      if (server === undefined) return;
      if (result.status === "fulfilled")
        items.push(...result.value.filter(visible).map((item) => listed(server, item)));
      else errors.push({ server, error: toErrorMessage(result.reason) });
    });
    return { [key]: items, ...(errors.length > 0 ? { errors } : {}) };
  };

  const listResources: ToolDefinition<TSchema, McpToolDetails> = {
    name: LIST_MCP_RESOURCES_TOOL,
    label: LIST_MCP_RESOURCES_TOOL,
    description:
      "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.",
    parameters: LIST_PARAMETERS as unknown as TSchema,
    outputSchema: LIST_OUTPUT_SCHEMA as unknown as TSchema,
    exposure: toToolExposure(options.exposure),
    annotations: readOnly,
    async execute(_toolCallId, params, signal) {
      const payload = await list(
        params,
        signal,
        "resources",
        async (server, cursor, requestOptions) => {
          const result = await server.resourcesPage(cursor, requestOptions);
          return { items: result.resources, nextCursor: result.nextCursor };
        },
        (server, requestOptions) => server.allResources(requestOptions),
      );
      return jsonResult(LIST_MCP_RESOURCES_TOOL, stringArgument(params, "server"), payload);
    },
  };

  const listTemplates: ToolDefinition<TSchema, McpToolDetails> = {
    name: LIST_MCP_RESOURCE_TEMPLATES_TOOL,
    label: LIST_MCP_RESOURCE_TEMPLATES_TOOL,
    description:
      "Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.",
    parameters: LIST_PARAMETERS as unknown as TSchema,
    outputSchema: LIST_TEMPLATES_OUTPUT_SCHEMA as unknown as TSchema,
    exposure: toToolExposure(options.exposure),
    annotations: readOnly,
    async execute(_toolCallId, params, signal) {
      const payload = await list(
        params,
        signal,
        "resourceTemplates",
        async (server, cursor, requestOptions) => {
          const result = await server.resourceTemplatesPage(cursor, requestOptions);
          return { items: result.resourceTemplates, nextCursor: result.nextCursor };
        },
        (server, requestOptions) => server.allResourceTemplates(requestOptions),
      );
      return jsonResult(
        LIST_MCP_RESOURCE_TEMPLATES_TOOL,
        stringArgument(params, "server"),
        payload,
      );
    },
  };

  const readResource: ToolDefinition<TSchema, McpToolDetails> = {
    name: READ_MCP_RESOURCE_TOOL,
    label: READ_MCP_RESOURCE_TOOL,
    description:
      "Read a specific resource from an MCP server given the server name and resource URI.",
    parameters: READ_PARAMETERS as unknown as TSchema,
    outputSchema: READ_OUTPUT_SCHEMA as unknown as TSchema,
    exposure: toToolExposure(options.exposure),
    annotations: readOnly,
    async execute(_toolCallId, params, signal) {
      const serverName = stringArgument(params, "server");
      const uri = stringArgument(params, "uri");
      if (serverName === undefined || serverName === "") throw new Error("server must be provided");
      if (uri === undefined || uri === "") throw new Error("uri must be provided");
      const server = findServer(serverName);
      const result = await server.readResource(uri, {
        ...(signal === undefined ? {} : { signal }),
        timeoutMs: server.timeoutMs,
      });

      const blocks: ContentBlock[] = result.contents.flatMap((contents) => [
        ...(result.contents.length > 1
          ? [{ type: "text" as const, text: `${contents.uri}:` }]
          : []),
        { type: "resource" as const, resource: contents },
      ]);
      const converted = await toModelContent(server.name, blocks);
      const { content, fullOutputPath } = await limitMcpContent(
        converted.length > 0 ? converted : [{ type: "text", text: `Resource ${uri} is empty.` }],
      );
      const contents = result.contents.map(({ _meta: _ignored, ...rest }) => rest);
      return {
        content,
        details: {
          server: server.name,
          tool: READ_MCP_RESOURCE_TOOL,
          ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
        },
        structuredContent: { server: server.name, uri, contents } as unknown as JsonValue,
      };
    },
  };

  return [listResources, listTemplates, readResource];
}
