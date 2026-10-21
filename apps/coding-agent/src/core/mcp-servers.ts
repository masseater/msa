import mcpServerConfigValidation from "./mcp-server-config-validation.ts";
import type mcpServersTypes from "./mcp-servers.types.ts";

const { isLoopbackRedirectUri, validateMcpServerConfig } = mcpServerConfigValidation;

function toolPatternRegExp(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "u");
}
function createToolNameMatcher(entries: readonly string[]): (name: string) => boolean {
  const names = new Set(entries.filter((entry) => !entry.includes("*")));
  const patterns = entries.filter((entry) => entry.includes("*")).map(toolPatternRegExp);
  return (name) => names.has(name) || patterns.some((pattern) => pattern.test(name));
}
const LIST_MCP_RESOURCES_TOOL = "list_mcp_resources";
const LIST_MCP_RESOURCE_TEMPLATES_TOOL = "list_mcp_resource_templates";
const READ_MCP_RESOURCE_TOOL = "read_mcp_resource";
const MCP_RESOURCE_TOOLS: ReadonlySet<string> = new Set([
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
]);
function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp__") || MCP_RESOURCE_TOOLS.has(name);
}
function mcpNamespace(server: string): string {
  return `mcp__${server.replace(/-/gu, "_")}`;
}
function getMcpToolExposure(
  config: mcpServersTypes.McpServerConfig,
  toolName: string,
): mcpServersTypes.McpExposure {
  const overrides = config.toolExposure ?? {};
  const exact = overrides[toolName];
  if (exact !== undefined) return exact;
  for (const [pattern, exposure] of Object.entries(overrides)) {
    if (pattern.includes("*") && toolPatternRegExp(pattern).test(toolName)) return exposure;
  }
  return config.exposure ?? "codemode";
}
const mcpServers = {
  LIST_MCP_RESOURCES_TOOL,
  LIST_MCP_RESOURCE_TEMPLATES_TOOL,
  READ_MCP_RESOURCE_TOOL,
  createToolNameMatcher,
  getMcpToolExposure,
  isLoopbackRedirectUri,
  isMcpToolName,
  mcpNamespace,
  validateMcpServerConfig,
};

export default mcpServers;
