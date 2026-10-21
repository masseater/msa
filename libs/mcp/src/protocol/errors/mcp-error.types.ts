import type McpErrorClass from "./mcp-error.ts";

declare namespace mcpErrorTypes {
  type McpError = McpErrorClass;
}

export type { mcpErrorTypes as default };
