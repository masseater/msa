import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";
import type { TSchema } from "typebox";

import awaitingModule from "../../core/awaiting.ts";
import type typesToolsTypes from "../../core/extensions/types-tools.types.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import mcpServers from "../../core/mcp-servers.ts";
import type configTypes from "./config.types.ts";
import resourcesPart1 from "./resources-part1.ts";
import resourcesPart2 from "./resources-part2.ts";
import resourcesPart3 from "./resources-part3.ts";
import type resourcesTypes from "./resources.types.ts";
import tools from "./tools.ts";
import type toolsTypes from "./tools.types.ts";

const { awaiting } = awaitingModule;
const { toToolExposure } = tools;
const { LIST_MCP_RESOURCES_TOOL } = mcpServers;
const { createMcpResourceToolDefinitionsPart3Part1 } = resourcesPart2;
const { LIST_OUTPUT_SCHEMA, LIST_PARAMETERS } = resourcesPart1;
const { createMcpResourceToolDefinitionsPart2 } = resourcesPart3;

function createMcpResourceToolDefinitionsPart3(
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
) {
  const listResources: extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails> = {
    annotations: readOnly,
    description:
      "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.",
    execute(_toolCallId, params, signal) {
      return Effect.runPromise(
        awaiting(function* () {
          return yield* createMcpResourceToolDefinitionsPart3Part1(list, params, signal);
        }),
      );
    },
    exposure: toToolExposure(options.exposure),
    label: LIST_MCP_RESOURCES_TOOL,
    name: LIST_MCP_RESOURCES_TOOL,
    outputSchema: LIST_OUTPUT_SCHEMA as unknown as TSchema,
    parameters: LIST_PARAMETERS as unknown as TSchema,
  };

  const listTemplates: extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails> =
    createMcpResourceToolDefinitionsPart2(readOnly, list, options);
  return { listResources, listTemplates };
}

const resourcesPart4 = {
  createMcpResourceToolDefinitionsPart3,
};

export default resourcesPart4;
