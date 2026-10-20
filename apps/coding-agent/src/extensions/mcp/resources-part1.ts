import type aiTypes from "@msa/ai/index.types";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import errorsModule from "../../utils/errors.ts";
import type configTypes from "./config.types.ts";
import type resourcesTypes from "./resources.types.ts";
import tools from "./tools.ts";
import type toolsTypes from "./tools.types.ts";

const { awaited, awaiting } = awaitingModule;
const { limitMcpContent } = tools;
const { toErrorMessage } = errorsModule;

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
            properties: {
              mimeType: optionalString,
              text: { type: "string" },
              uri: { type: "string" },
            },
            required: ["uri", "text"],
            type: "object",
          },
          {
            properties: {
              blob: { description: "base64", type: "string" },
              mimeType: optionalString,
              uri: { type: "string" },
            },
            required: ["uri", "blob"],
            type: "object",
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

function* createMcpResourceToolDefinitionsPart5<T extends { _meta?: unknown }>(
  cursor: string | undefined,
  options: {
    exposure: configTypes.McpExposure;
    servers: () => readonly resourcesTypes.McpResourceServer[];
  },
  all: (
    server: resourcesTypes.McpResourceServer,
    options: mcpTypes.McpRequestOptions,
  ) => Promise<T[]>,
  signal: AbortSignal | undefined,
  visible: (item: T) => boolean,
  key: string,
) {
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
}

const resourcesPart1 = {
  LIST_OUTPUT_SCHEMA,
  LIST_PARAMETERS,
  LIST_TEMPLATES_OUTPUT_SCHEMA,
  READ_OUTPUT_SCHEMA,
  READ_PARAMETERS,
  createMcpResourceToolDefinitionsPart5,
  isMcpAppResource,
  jsonResult,
  listed,
  stringArgument,
};

export default resourcesPart1;
