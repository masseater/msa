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
import type resourcesTypes from "./resources.types.ts";
import tools from "./tools.ts";
import type toolsTypes from "./tools.types.ts";

const { awaited, awaiting } = awaitingModule;
const { LIST_MCP_RESOURCE_TEMPLATES_TOOL } = mcpServers;
const { toToolExposure } = tools;
const { createMcpResourceToolDefinitionsPart2Part1 } = resourcesPart2;
const { LIST_PARAMETERS, LIST_TEMPLATES_OUTPUT_SCHEMA, jsonResult, stringArgument } =
  resourcesPart1;

function createMcpResourceToolDefinitionsPart2(
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
): extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails, any> {
  return {
    annotations: readOnly,
    description:
      "Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.",
    execute(_toolCallId, params, signal) {
      return Effect.runPromise(
        awaiting(function* () {
          const payload = yield* createMcpResourceToolDefinitionsPart2Part1(list, params, signal);
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
}

const resourcesPart3 = {
  createMcpResourceToolDefinitionsPart2,
};

export default resourcesPart3;
