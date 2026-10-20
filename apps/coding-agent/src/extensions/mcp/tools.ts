import mcpServers from "../../core/mcp-servers.ts";
import toolsPart1 from "./tools-part1.ts";
import toolsPart2 from "./tools-part2.ts";
import toolsPart4 from "./tools-part4.ts";
import toolsPart6 from "./tools-part6.ts";
import toolsPart7 from "./tools-part7.ts";
import toolsPart9 from "./tools-part9.ts";

const { READ_MCP_RESOURCE_TOOL } = mcpServers;
const { MCP_OUTPUT_MAX_BYTES, createMcpResultSchema, createMcpToolName, toToolExposure } =
  toolsPart1;
const { convertMcpResult } = toolsPart6;
const { createMcpToolDefinition } = toolsPart9;
const { createMcpToolRenderers } = toolsPart7;
const { limitMcpContent } = toolsPart2;
const { toModelContent } = toolsPart4;

const tools = {
  MCP_OUTPUT_MAX_BYTES,
  READ_MCP_RESOURCE_TOOL,
  convertMcpResult,
  createMcpResultSchema,
  createMcpToolDefinition,
  createMcpToolName,
  createMcpToolRenderers,
  limitMcpContent,
  toModelContent,
  toToolExposure,
};

export default tools;
