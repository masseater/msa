import type contentTypes from "../protocol/content.types.ts";
import type jsonrpcTypes from "../protocol/jsonrpc.types.ts";
import type typesModule from "../protocol/types.types.ts";

declare namespace mcpProtocolKitTypes {
  type AudioContent = contentTypes.AudioContent;
  type BlobResourceContents = contentTypes.BlobResourceContents;
  type CallToolResult = contentTypes.CallToolResult;
  type ContentAnnotations = contentTypes.ContentAnnotations;
  type ContentBlock = contentTypes.ContentBlock;
  type EmbeddedResourceContent = contentTypes.EmbeddedResourceContent;
  type ImageContent = contentTypes.ImageContent;
  type LlmContent = contentTypes.LlmContent;
  type ResourceLinkContent = contentTypes.ResourceLinkContent;
  type TextContent = contentTypes.TextContent;
  type TextResourceContents = contentTypes.TextResourceContents;
  type JsonRpcErrorObject = jsonrpcTypes.JsonRpcErrorObject;
  type JsonRpcErrorResponse = jsonrpcTypes.JsonRpcErrorResponse;
  type JsonRpcId = jsonrpcTypes.JsonRpcId;
  type JsonRpcMessage = jsonrpcTypes.JsonRpcMessage;
  type JsonRpcNotification = jsonrpcTypes.JsonRpcNotification;
  type JsonRpcRequest = jsonrpcTypes.JsonRpcRequest;
  type JsonRpcResponse = jsonrpcTypes.JsonRpcResponse;
  type JsonRpcSuccessResponse = jsonrpcTypes.JsonRpcSuccessResponse;
  type CancelledNotification = typesModule.CancelledNotification;
  type ClientCapabilities = typesModule.ClientCapabilities;
  type Implementation = typesModule.Implementation;
  type InitializeParams = typesModule.InitializeParams;
  type InitializeResult = typesModule.InitializeResult;
  type ListResourcesResult = typesModule.ListResourcesResult;
  type ListResourceTemplatesResult = typesModule.ListResourceTemplatesResult;
  type ListToolsResult = typesModule.ListToolsResult;
  type ProgressNotification = typesModule.ProgressNotification;
  type ReadResourceResult = typesModule.ReadResourceResult;
  type Resource = typesModule.Resource;
  type ResourceTemplate = typesModule.ResourceTemplate;
  type Root = typesModule.Root;
  type ServerCapabilities = typesModule.ServerCapabilities;
  type SupportedProtocolVersion = typesModule.SupportedProtocolVersion;
  type Tool = typesModule.Tool;
  type ToolAnnotations = typesModule.ToolAnnotations;
  type ToolExecution = typesModule.ToolExecution;
}

export type { mcpProtocolKitTypes as default };
