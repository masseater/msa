import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";
import type { TSchema } from "typebox";

import awaitingModule from "../../core/awaiting.ts";
import type typesToolsTypes from "../../core/extensions/types-tools.types.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import mcpServers from "../../core/mcp-servers.ts";
import type configTypes from "./config.types.ts";
import resourcesPart1 from "./resources-part1.ts";
import resourcesPart4 from "./resources-part4.ts";
import resourcesPart5 from "./resources-part5.ts";
import type resourcesTypes from "./resources.types.ts";
import tools from "./tools.ts";
import type toolsTypes from "./tools.types.ts";

const { awaiting } = awaitingModule;
const { toToolExposure } = tools;
const { READ_MCP_RESOURCE_TOOL } = mcpServers;
const { createMcpResourceToolDefinitionsPart3 } = resourcesPart4;
const { createMcpResourceToolDefinitionsPart1 } = resourcesPart5;
const { READ_OUTPUT_SCHEMA, READ_PARAMETERS } = resourcesPart1;

function createMcpResourceToolDefinitionsPart4(
  readOnly: typesToolsTypes.ToolAnnotations,
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
  options: {
    exposure: configTypes.McpExposure;
    servers: () => readonly resourcesTypes.McpResourceServer[];
  },
  findServer: (name: string) => resourcesTypes.McpResourceServer,
): extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails>[] {
  const {
    listResources,
    listTemplates,
  }: {
    listResources: extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails, any>;
    listTemplates: extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails, any>;
  } = createMcpResourceToolDefinitionsPart3(readOnly, list, options);

  const readResource: extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails> =
    createMcpResourceToolDefinitionsPart4Part1(readOnly, findServer, options);

  return [listResources, listTemplates, readResource];
}

const resourcesPart6 = {
  createMcpResourceToolDefinitionsPart4,
};

export default resourcesPart6;

function createMcpResourceToolDefinitionsPart4Part1(
  readOnly: typesToolsTypes.ToolAnnotations,
  findServer: (name: string) => resourcesTypes.McpResourceServer,
  options: {
    exposure: configTypes.McpExposure;
    servers: () => readonly resourcesTypes.McpResourceServer[];
  },
): extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails, any> {
  return {
    annotations: readOnly,
    description:
      "Read a specific resource from an MCP server given the server name and resource URI.",
    execute(_toolCallId, params, signal) {
      return Effect.runPromise(
        awaiting(function* () {
          return yield* createMcpResourceToolDefinitionsPart1(params, findServer, signal);
        }),
      );
    },
    exposure: toToolExposure(options.exposure),
    label: READ_MCP_RESOURCE_TOOL,
    name: READ_MCP_RESOURCE_TOOL,
    outputSchema: READ_OUTPUT_SCHEMA as unknown as TSchema,
    parameters: READ_PARAMETERS as unknown as TSchema,
  };
}
