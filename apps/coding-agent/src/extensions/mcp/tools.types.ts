import type mcpTypes from "@msa/mcp/index.types";

declare namespace toolsTypes {
  interface McpToolDetails {
    server: string;
    tool: string;

    fullOutputPath?: string;
  }

  type McpOutputSaver = (data: string | Uint8Array, extension: string) => Promise<string>;

  interface McpToolCaller {
    callTool(
      name: string,
      args: Record<string, unknown>,
      options: mcpTypes.McpRequestOptions,
    ): Promise<mcpTypes.CallToolResult>;
  }

  interface ConvertMcpResultOptions {
    saveOutput?: McpOutputSaver | undefined;

    readableResources?: boolean | undefined;
  }
}

export type { toolsTypes as default };
