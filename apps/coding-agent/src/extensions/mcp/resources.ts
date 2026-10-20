import mcpServers from "../../core/mcp-servers.ts";
import resourcesPart7 from "./resources-part7.ts";

const { LIST_MCP_RESOURCES_TOOL, LIST_MCP_RESOURCE_TEMPLATES_TOOL, READ_MCP_RESOURCE_TOOL } =
  mcpServers;
const { createMcpResourceToolDefinitions } = resourcesPart7;

const resources = {
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
  createMcpResourceToolDefinitions,
};

export default resources;
