import type mcpTypes from "@msa/mcp/index.types";

declare namespace resourcesTypes {
  interface McpResourceServer {
    name: string;
    timeoutMs: number;
    resourcesPage(
      cursor: string | undefined,
      options: mcpTypes.McpRequestOptions,
    ): Promise<mcpTypes.ListResourcesResult>;
    resourceTemplatesPage(
      cursor: string | undefined,
      options: mcpTypes.McpRequestOptions,
    ): Promise<mcpTypes.ListResourceTemplatesResult>;
    allResources(options: mcpTypes.McpRequestOptions): Promise<mcpTypes.Resource[]>;
    allResourceTemplates(options: mcpTypes.McpRequestOptions): Promise<mcpTypes.ResourceTemplate[]>;
    readResource(
      uri: string,
      options: mcpTypes.McpRequestOptions,
    ): Promise<mcpTypes.ReadResourceResult>;
  }
}

export type { resourcesTypes as default };
