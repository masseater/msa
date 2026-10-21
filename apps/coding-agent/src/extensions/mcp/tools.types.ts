import type mcpTypes from "@msa/mcp/index.types";
import type { TSchema } from "typebox";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type configTypes from "./config.types.ts";

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

  interface McpToolDefinitionOptions {
    server: string;
    tool: mcpTypes.Tool;
    name: string;
    exposure: configTypes.McpExposure;
    namespace: extensionsTypesTypes.ToolNamespace;
    timeoutMs: number;
    getClient: () => Promise<McpToolCaller>;
    readableResources?: () => boolean;
  }

  type McpToolDefinition = extensionsTypesTypes.ToolDefinition<TSchema, McpToolDetails>;

  interface ConvertMcpResultOptions {
    saveOutput?: McpOutputSaver | undefined;

    readableResources?: boolean | undefined;
  }
}

export type { toolsTypes as default };
