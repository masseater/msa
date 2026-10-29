import type McpServerRegistryClass from "./mcp-server-registry.ts";

declare namespace mcpServersTypes {
  type McpExposure = "codemode" | "deferred" | "direct" | "hidden";

  interface McpServerConfigBase {
    exposure?: McpExposure;
    description?: string;
    toolExposure?: Record<string, McpExposure>;
    enabled?: boolean;
    timeout?: number;
  }

  interface McpStdioServerConfig extends McpServerConfigBase {
    type?: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  }

  interface McpOAuthConfig {
    clientId?: string;
    clientSecret?: string;
    callbackPort?: number;
    callbackUrl?: string;
    scope?: string;
    clientName?: string;
    clientRegistration?: "dcr" | "cimd";
    authServerMetadataUrl?: string;
  }

  interface McpHttpServerConfig extends McpServerConfigBase {
    type?: "http";
    url: string;
    headers?: Record<string, string>;
    oauth?: McpOAuthConfig;
    auth?: { provider: string };
  }

  type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

  interface RegisteredMcpServer {
    name: string;
    config: McpServerConfig;
    extensionPath: string;
  }

  type McpServerAdmission =
    | (RegisteredMcpServer & { ignored: false })
    | { name: string; extensionPath: string; ignored: true };

  type McpServerRegistry = (typeof McpServerRegistryClass)["prototype"];
}

export type { mcpServersTypes as default };
