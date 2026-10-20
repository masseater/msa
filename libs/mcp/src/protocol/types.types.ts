import type contentTypes from "./content.types.ts";
import type jsonrpcTypes from "./jsonrpc.types.ts";
import type types from "./types.ts";

declare namespace typesModule {
  type SupportedProtocolVersion = (typeof types.SUPPORTED_PROTOCOL_VERSIONS)[number];

  interface Implementation {
    name: string;
    version: string;
    title?: string;
  }

  interface Root {
    uri: string;
    name?: string;
  }

  interface ClientCapabilities {
    experimental?: Record<string, unknown>;
    roots?: { listChanged?: boolean };
    sampling?: Record<string, unknown>;
    elicitation?: Record<string, unknown>;
  }

  interface ServerCapabilities {
    experimental?: Record<string, unknown>;
    logging?: Record<string, unknown>;
    prompts?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    tools?: { listChanged?: boolean };
    completions?: Record<string, unknown>;
  }

  interface InitializeParams {
    protocolVersion: string;
    capabilities: ClientCapabilities;
    clientInfo: Implementation;
  }

  interface InitializeResult {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    serverInfo: Implementation;
    instructions?: string;
  }

  interface ProgressNotification {
    progressToken: string | number;
    progress: number;
    total?: number;
    message?: string;
  }

  interface CancelledNotification {
    requestId: jsonrpcTypes.JsonRpcId;
    reason?: string;
  }

  interface ToolAnnotations {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  }

  interface ToolExecution {
    taskSupport?: "forbidden" | "optional" | "required";
  }

  interface Tool {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: ToolAnnotations;
    execution?: ToolExecution;
    _meta?: Record<string, unknown>;
  }

  interface ListToolsResult {
    tools: Tool[];
    nextCursor?: string;
    _meta?: Record<string, unknown>;
  }

  interface Resource {
    uri: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    size?: number;
    annotations?: contentTypes.ContentAnnotations;
    _meta?: Record<string, unknown>;
  }

  interface ResourceTemplate {
    uriTemplate: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    annotations?: contentTypes.ContentAnnotations;
    _meta?: Record<string, unknown>;
  }

  interface ListResourcesResult {
    resources: Resource[];
    nextCursor?: string;
    _meta?: Record<string, unknown>;
  }

  interface ListResourceTemplatesResult {
    resourceTemplates: ResourceTemplate[];
    nextCursor?: string;
    _meta?: Record<string, unknown>;
  }

  interface ReadResourceResult {
    contents: (contentTypes.TextResourceContents | contentTypes.BlobResourceContents)[];
    _meta?: Record<string, unknown>;
  }
}

export type { typesModule as default };
