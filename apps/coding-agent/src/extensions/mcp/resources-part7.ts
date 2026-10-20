import type { TSchema } from "typebox";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type configTypes from "./config.types.ts";
import resourcesPart2 from "./resources-part2.ts";
import resourcesPart6 from "./resources-part6.ts";
import type resourcesTypes from "./resources.types.ts";
import type toolsTypes from "./tools.types.ts";

const { createMcpResourceToolDefinitionsPart6 } = resourcesPart2;
const { createMcpResourceToolDefinitionsPart4 } = resourcesPart6;

function createMcpResourceToolDefinitions(options: {
  exposure: configTypes.McpExposure;
  servers: () => readonly resourcesTypes.McpResourceServer[];
}): extensionsTypesTypes.ToolDefinition<TSchema, toolsTypes.McpToolDetails>[] {
  const readOnly: extensionsTypesTypes.ToolAnnotations = { readOnlyHint: true };

  const findServer = (name: string): resourcesTypes.McpResourceServer => {
    const servers = options.servers();
    const server = servers.find((candidate) => candidate.name === name);
    if (server !== undefined) return server;
    const available = servers.map((candidate) => candidate.name).join(", ");
    throw new Error(
      `MCP server "${name}" has no resources${available === "" ? "" : `. Servers with resources: ${available}`}`,
    );
  };

  const list = createMcpResourceToolDefinitionsPart6(findServer, options);

  return createMcpResourceToolDefinitionsPart4(readOnly, list, options, findServer);
}

const resourcesPart7 = {
  createMcpResourceToolDefinitions,
};

export default resourcesPart7;
