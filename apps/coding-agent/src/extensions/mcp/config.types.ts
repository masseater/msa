import type mcpServersTypes from "../../core/mcp-servers.types.ts";

declare namespace configTypes {
  interface McpServerEntry {
    name: string;
    config: mcpServersTypes.McpServerConfig;

    source: string;

    scope?: "builtin" | "global" | "project" | "extension";

    override?: string;
  }

  interface LoadedMcpConfig {
    servers: McpServerEntry[];

    autoEnableCodemode?: boolean;
    errors: string[];

    projectConfig?: string;
  }

  interface McpServerConfigPatch {
    enabled?: boolean;
    exposure?: mcpServersTypes.McpExposure;
  }

  type McpExposure = mcpServersTypes.McpExposure;

  type McpHttpServerConfig = mcpServersTypes.McpHttpServerConfig;

  type McpOAuthConfig = mcpServersTypes.McpOAuthConfig;

  type McpServerConfig = mcpServersTypes.McpServerConfig;

  type McpStdioServerConfig = mcpServersTypes.McpStdioServerConfig;
}

export type { configTypes as default };
