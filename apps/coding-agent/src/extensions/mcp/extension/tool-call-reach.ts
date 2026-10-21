import mcpServers from "../../../core/mcp-servers.ts";
import resources from "../resources.ts";

const { mcpNamespace } = mcpServers;
const { READ_MCP_RESOURCE_TOOL, LIST_MCP_RESOURCE_TEMPLATES_TOOL, LIST_MCP_RESOURCES_TOOL } =
  resources;

const RESOURCE_TOOL_NAMES: ReadonlySet<string> = new Set([
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
]);

function reachesServer(reach: "all" | readonly string[], server: string): boolean {
  if (reach === "all") return true;
  const namespace = mcpNamespace(server);
  return reach.some((word) => word.includes(namespace));
}

const toolCallReach = { RESOURCE_TOOL_NAMES, reachesServer };

export default toolCallReach;
