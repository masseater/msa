declare namespace claudeCodeSdkTypes {
  interface Sdk {
    readonly query: typeof import("@anthropic-ai/claude-agent-sdk").query;
    readonly usageLimitPrefixes: typeof import("@anthropic-ai/claude-agent-sdk").USAGE_LIMIT_ERROR_PREFIXES;
    readonly McpServer: typeof import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
    readonly CallToolRequestSchema: typeof import("@modelcontextprotocol/sdk/types.js").CallToolRequestSchema;
    readonly ListToolsRequestSchema: typeof import("@modelcontextprotocol/sdk/types.js").ListToolsRequestSchema;
  }
}

export type { claudeCodeSdkTypes as default };
