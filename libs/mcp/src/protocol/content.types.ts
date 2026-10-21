declare namespace contentTypes {
  interface ContentAnnotations {
    audience?: ("user" | "assistant")[];
    priority?: number;
    lastModified?: string;
  }

  interface TextContent {
    type: "text";
    text: string;
    annotations?: ContentAnnotations;
    _meta?: Record<string, unknown>;
  }

  interface ImageContent {
    type: "image";
    data: string;
    mimeType: string;
    annotations?: ContentAnnotations;
    _meta?: Record<string, unknown>;
  }

  interface AudioContent {
    type: "audio";
    data: string;
    mimeType: string;
    annotations?: ContentAnnotations;
    _meta?: Record<string, unknown>;
  }

  interface ResourceLinkContent {
    type: "resource_link";
    uri: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    size?: number;
    annotations?: ContentAnnotations;
    _meta?: Record<string, unknown>;
  }

  interface TextResourceContents {
    uri: string;
    mimeType?: string;
    text: string;
    _meta?: Record<string, unknown>;
  }

  interface BlobResourceContents {
    uri: string;
    mimeType?: string;
    blob: string;
    _meta?: Record<string, unknown>;
  }

  interface EmbeddedResourceContent {
    type: "resource";
    resource: TextResourceContents | BlobResourceContents;
    annotations?: ContentAnnotations;
    _meta?: Record<string, unknown>;
  }

  type ContentBlock =
    | TextContent
    | ImageContent
    | AudioContent
    | ResourceLinkContent
    | EmbeddedResourceContent;

  interface CallToolResult {
    content: ContentBlock[];
    structuredContent?: unknown;
    isError?: boolean;
    _meta?: Record<string, unknown>;
  }

  type LlmContent =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string };
}

export type { contentTypes as default };
