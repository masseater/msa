import mcpServers from "../../core/mcp-servers.ts";
import outputLimit from "./tools/output-limit.ts";
import resultContent from "./tools/result-content.ts";
import resultSchema from "./tools/result-schema.ts";
import toolDefinition from "./tools/tool-definition.ts";
import toolRenderers from "./tools/tool-renderers.ts";
import toolShape from "./tools/tool-shape.ts";

const { READ_MCP_RESOURCE_TOOL } = mcpServers;
const { MCP_OUTPUT_MAX_BYTES, limitMcpContent } = outputLimit;
const { createMcpResultSchema } = resultSchema;
const { createMcpToolName, toToolExposure } = toolShape;
const { convertMcpResult, toModelContent } = resultContent;
const { createMcpToolDefinition } = toolDefinition;
const { createMcpToolRenderers } = toolRenderers;

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
