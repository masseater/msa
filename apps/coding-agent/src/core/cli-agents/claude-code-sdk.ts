import type claudeCodeSdkTypes from "./claude-code-sdk.types.ts";

let loaded: Promise<claudeCodeSdkTypes.Sdk> | undefined;

const loadSdk = (): Promise<claudeCodeSdkTypes.Sdk> => {
  loaded ??= Promise.all([
    import("@anthropic-ai/claude-agent-sdk"),
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]).then(([agent, mcp, types]) => ({
    CallToolRequestSchema: types.CallToolRequestSchema,
    ListToolsRequestSchema: types.ListToolsRequestSchema,
    McpServer: mcp.McpServer,
    query: agent.query,
    usageLimitPrefixes: agent.USAGE_LIMIT_ERROR_PREFIXES,
  }));
  return loaded;
};

const claudeCodeSdk = { loadSdk };

export default claudeCodeSdk;
