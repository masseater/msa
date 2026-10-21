import type { TSchema } from "typebox";

import mcpServers from "../../core/mcp-servers.ts";
import type configTypes from "./config.types.ts";
import type resourcesTypes from "./resources.types.ts";
import readResourceModule from "./resources/read-resource.ts";
import resourceListing from "./resources/resource-listing.ts";
import resourceSchemas from "./resources/resource-schemas.ts";
import tools from "./tools.ts";
import type toolsTypes from "./tools.types.ts";

const { LIST_MCP_RESOURCES_TOOL, LIST_MCP_RESOURCE_TEMPLATES_TOOL, READ_MCP_RESOURCE_TOOL } =
  mcpServers;
const { toToolExposure } = tools;
const { listTool } = resourceListing;
const { readResource } = readResourceModule;
const {
  LIST_OUTPUT_SCHEMA,
  LIST_PARAMETERS,
  LIST_TEMPLATES_OUTPUT_SCHEMA,
  READ_OUTPUT_SCHEMA,
  READ_PARAMETERS,
} = resourceSchemas;

type Servers = () => readonly resourcesTypes.McpResourceServer[];

const readOnly = { readOnlyHint: true };

function resourceTool(
  exposure: ReturnType<typeof toToolExposure>,
  tool: Pick<toolsTypes.McpToolDefinition, "name" | "description" | "execute"> & {
    outputSchema: unknown;
    parameters: unknown;
  },
): toolsTypes.McpToolDefinition {
  return {
    annotations: readOnly,
    description: tool.description,
    execute: tool.execute,
    exposure,
    label: tool.name,
    name: tool.name,
    outputSchema: tool.outputSchema as TSchema,
    parameters: tool.parameters as TSchema,
  };
}

function createMcpResourceToolDefinitions(options: {
  exposure: configTypes.McpExposure;
  servers: Servers;
}): toolsTypes.McpToolDefinition[] {
  const { servers } = options;
  const exposure = toToolExposure(options.exposure);
  return [
    resourceTool(exposure, {
      description:
        "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.",
      execute: listTool(servers, LIST_MCP_RESOURCES_TOOL, {
        all: (server, requestOptions) => server.allResources(requestOptions),
        key: "resources",
        page: (server, cursor, requestOptions) =>
          server
            .resourcesPage(cursor, requestOptions)
            .then((result) => ({ items: result.resources, nextCursor: result.nextCursor })),
      }),
      name: LIST_MCP_RESOURCES_TOOL,
      outputSchema: LIST_OUTPUT_SCHEMA,
      parameters: LIST_PARAMETERS,
    }),
    resourceTool(exposure, {
      description:
        "Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.",
      execute: listTool(servers, LIST_MCP_RESOURCE_TEMPLATES_TOOL, {
        all: (server, requestOptions) => server.allResourceTemplates(requestOptions),
        key: "resourceTemplates",
        page: (server, cursor, requestOptions) =>
          server
            .resourceTemplatesPage(cursor, requestOptions)
            .then((result) => ({ items: result.resourceTemplates, nextCursor: result.nextCursor })),
      }),
      name: LIST_MCP_RESOURCE_TEMPLATES_TOOL,
      outputSchema: LIST_TEMPLATES_OUTPUT_SCHEMA,
      parameters: LIST_PARAMETERS,
    }),
    resourceTool(exposure, {
      description:
        "Read a specific resource from an MCP server given the server name and resource URI.",
      execute: (_toolCallId, params, signal) => readResource(servers, params, signal),
      name: READ_MCP_RESOURCE_TOOL,
      outputSchema: READ_OUTPUT_SCHEMA,
      parameters: READ_PARAMETERS,
    }),
  ];
}

const resources = {
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
  createMcpResourceToolDefinitions,
};

export default resources;
