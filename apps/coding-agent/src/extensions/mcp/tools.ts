import { createHash } from "node:crypto";

import type { AgentToolResult } from "@msa/agent-core";
import type { ImageContent, JsonValue, TextContent } from "@msa/ai";
import {
  type CallToolResult,
  type ContentBlock,
  type McpRequestOptions,
  type Tool as McpTool,
  toLlmContent,
} from "@msa/mcp";
import { Container, Spacer, Text } from "@msa/tui";
import type { TSchema } from "typebox";

import type {
  ToolAnnotations,
  ToolDefinition,
  ToolExposure,
  ToolNamespace,
  ToolRenderers,
} from "../../core/extensions/types.ts";
import { READ_MCP_RESOURCE_TOOL } from "../../core/mcp-servers.ts";
import {
  formatToolCallWithArgs,
  getTextOutput,
  replaceTabs,
} from "../../core/tools/render-utils.ts";
import { formatSize, truncateMiddle } from "../../core/tools/truncate.ts";
import { collapsedOutput } from "../../modes/interactive/components/visual-truncate.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import { writeOutputFile } from "../../utils/output-files.ts";
import type { McpExposure } from "./config.ts";

export function toToolExposure(exposure: McpExposure): ToolExposure {
  return exposure === "codemode" ? "deferred" : exposure;
}

const MAX_TOOL_NAME_LENGTH = 64;

export const MCP_OUTPUT_MAX_BYTES = 20 * 1024;

export { READ_MCP_RESOURCE_TOOL };

export interface McpToolDetails {
  server: string;
  tool: string;

  fullOutputPath?: string;
}

export type McpOutputSaver = (data: string | Uint8Array, extension: string) => Promise<string>;

export function saveToTempFile(data: string | Uint8Array, extension: string): Promise<string> {
  return writeOutputFile("msa-mcp", extension, data);
}

export interface McpToolCaller {
  callTool(
    name: string,
    args: Record<string, unknown>,
    options: McpRequestOptions,
  ): Promise<CallToolResult>;
}

export function createMcpToolName(
  server: string,
  tool: string,
  isTaken: (name: string) => boolean = () => false,
): string {
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
  if (name.length <= MAX_TOOL_NAME_LENGTH && !isTaken(name)) return name;
  const hash = createHash("sha256").update(`${server}\0${tool}`).digest("hex").slice(0, 8);
  return `${name.slice(0, MAX_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

function textOf(content: readonly (TextContent | ImageContent)[]): string {
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const CONTENT_BLOCK_SCHEMA = {
  type: "object",
  properties: {
    type: { enum: ["text", "image", "audio", "resource_link", "resource"] },
    text: { type: "string" },
    data: { type: "string" },
    mimeType: { type: "string" },
  },
  required: ["type"],
  additionalProperties: true,
};

const SCHEMA_DATA_KEYWORDS: ReadonlySet<string> = new Set(["const", "enum", "default", "examples"]);

const SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
  "$defs",
  "definitions",
]);

function relocateSchema(schema: unknown, pointer: string): unknown {
  if (Array.isArray(schema)) return schema.map((item) => relocateSchema(item, pointer));
  if (typeof schema !== "object" || schema === null) return schema;
  const relocated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$ref" && typeof value === "string" && (value === "#" || value.startsWith("#/"))) {
      relocated[key] = `${pointer}${value.slice(1)}`;
    } else if (SCHEMA_DATA_KEYWORDS.has(key)) {
      relocated[key] = value;
    } else if (
      SCHEMA_MAP_KEYWORDS.has(key) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      relocated[key] = Object.fromEntries(
        Object.entries(value).map(([name, subschema]) => [
          name,
          relocateSchema(subschema, pointer),
        ]),
      );
    } else {
      relocated[key] = relocateSchema(value, pointer);
    }
  }
  return relocated;
}

export function createMcpResultSchema(
  structuredContentSchema: Record<string, unknown> | undefined,
): TSchema {
  return {
    type: "object",
    properties: {
      content: { type: "array", items: CONTENT_BLOCK_SCHEMA },

      structuredContent: structuredContentSchema
        ? relocateSchema(structuredContentSchema, "#/properties/structuredContent")
        : {},
      isError: { type: "boolean" },
    },
    required: ["content"],

    additionalProperties: true,
  } as unknown as TSchema;
}

export async function limitMcpContent(
  content: (TextContent | ImageContent)[],
  saveOutput: McpOutputSaver = saveToTempFile,
): Promise<{ content: (TextContent | ImageContent)[]; fullOutputPath?: string }> {
  const combined = textOf(content);
  const truncation = truncateMiddle(combined, MCP_OUTPUT_MAX_BYTES);
  if (!truncation.truncated) return { content };
  let fullOutputPath: string | undefined;
  let where: string;
  try {
    fullOutputPath = await saveOutput(combined, ".txt");
    where = `[Full output: ${fullOutputPath} (read it with offset/limit)]`;
  } catch (error) {
    where = `[Could not save the full output: ${toErrorMessage(error)}]`;
  }
  const tokens = Math.ceil(truncation.totalBytes / 4);
  const text = `Warning: truncated output (original token count: ${tokens})\nTotal output lines: ${truncation.totalLines}\n\n${truncation.content}\n\n${where}`;
  return {
    content: [{ type: "text", text }, ...content.filter((block) => block.type === "image")],
    ...(fullOutputPath ? { fullOutputPath } : {}),
  };
}

export interface ConvertMcpResultOptions {
  saveOutput?: McpOutputSaver | undefined;

  readableResources?: boolean | undefined;
}

function extensionOf(uri: string): string {
  const path = URL.canParse(uri) ? new URL(uri).pathname : uri;
  return /\.[A-Za-z0-9]{1,8}$/.exec(path)?.[0] ?? ".bin";
}

function isTextMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const type = (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase();
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  );
}

async function blockToContent(
  server: string,
  block: ContentBlock,
  options: ConvertMcpResultOptions,
): Promise<(TextContent | ImageContent)[]> {
  if (block.type === "resource_link") {
    const details = [
      block.mimeType,
      block.size === undefined ? undefined : formatSize(block.size),
    ].filter(Boolean);
    const read = options.readableResources
      ? `. Read it with ${READ_MCP_RESOURCE_TOOL} (server "${server}")`
      : "";
    const description = block.description ? `: ${block.description}` : "";
    return [
      {
        type: "text",
        text: `[Resource ${block.uri} "${block.title ?? block.name}"${details.length > 0 ? ` (${details.join(", ")})` : ""}${description}${read}]`,
      },
    ];
  }
  if (
    block.type === "resource" &&
    "blob" in block.resource &&
    !block.resource.mimeType?.startsWith("image/")
  ) {
    const { uri, mimeType, blob } = block.resource;
    const data = Buffer.from(blob, "base64");
    if (isTextMimeType(mimeType)) return [{ type: "text", text: data.toString("utf8") }];
    const kind = `${mimeType ?? "unknown type"}, ${formatSize(data.length)}`;
    try {
      const path = await (options.saveOutput ?? saveToTempFile)(data, extensionOf(uri));
      return [{ type: "text", text: `[Binary resource ${uri} (${kind}) saved to ${path}]` }];
    } catch (error) {
      const reason = toErrorMessage(error);
      return [
        { type: "text", text: `[Binary resource ${uri} (${kind}) could not be saved: ${reason}]` },
      ];
    }
  }
  return toLlmContent({ content: [block] });
}

export async function toModelContent(
  server: string,
  blocks: readonly ContentBlock[],
  options: ConvertMcpResultOptions = {},
): Promise<(TextContent | ImageContent)[]> {
  return (await Promise.all(blocks.map((block) => blockToContent(server, block, options)))).flat();
}

export async function convertMcpResult(
  server: string,
  tool: string,
  result: CallToolResult,
  options: ConvertMcpResultOptions = {},
): Promise<AgentToolResult<McpToolDetails>> {
  const converted: (TextContent | ImageContent)[] =
    result.content.length > 0
      ? await toModelContent(server, result.content, options)
      : toLlmContent(result);
  if (result.isError && textOf(converted) === "") {
    converted.push({ type: "text", text: `MCP tool ${server}/${tool} returned an error` });
  }
  const { content, fullOutputPath } = await limitMcpContent(converted, options.saveOutput);
  const { _meta: _ignored, ...scriptResult } = result;
  return {
    content,
    details: { server, tool, ...(fullOutputPath ? { fullOutputPath } : {}) },
    structuredContent: scriptResult as unknown as JsonValue,
    ...(result.isError ? { isError: true } : {}),
  };
}

function toParameters(schema: Record<string, unknown>): TSchema {
  return {
    ...schema,
    type: schema["type"] ?? "object",
    ...(schema["properties"] === undefined ? { properties: {} } : {}),
  } as unknown as TSchema;
}

const ANNOTATION_HINTS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
] as const;

function toToolAnnotations(tool: McpTool): ToolAnnotations | undefined {
  const annotations: ToolAnnotations = {};
  for (const hint of ANNOTATION_HINTS) {
    const value = tool.annotations?.[hint];
    if (typeof value === "boolean") annotations[hint] = value;
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

export function createMcpToolDefinition(options: {
  server: string;
  tool: McpTool;
  name: string;
  exposure: McpExposure;
  namespace: ToolNamespace;
  timeoutMs: number;
  getClient: () => Promise<McpToolCaller>;

  readableResources?: () => boolean;
}): ToolDefinition<TSchema, McpToolDetails> {
  const { server, tool } = options;
  const title = tool.title ?? tool.annotations?.title;
  const annotations = toToolAnnotations(tool);
  const label = `${server}/${tool.name}`;
  return {
    name: options.name,
    label,
    description: tool.description?.trim() || title || `MCP tool ${tool.name} from server ${server}`,
    parameters: toParameters(tool.inputSchema),
    outputSchema: createMcpResultSchema(tool.outputSchema),
    exposure: toToolExposure(options.exposure),
    namespace: options.namespace,
    ...(annotations ? { annotations } : {}),
    ...createMcpToolRenderers(label),
    async execute(_toolCallId, params, signal, onUpdate) {
      const client = await options.getClient();
      const result = await client.callTool(tool.name, (params ?? {}) as Record<string, unknown>, {
        ...(signal ? { signal } : {}),
        timeoutMs: options.timeoutMs,
        onProgress: (progress) => {
          const total = progress.total === undefined ? "" : `/${progress.total}`;
          const text = progress.message ?? `Progress ${progress.progress}${total}`;
          onUpdate?.({ content: [{ type: "text", text }], details: { server, tool: tool.name } });
        },
      });
      return convertMcpResult(server, tool.name, result, {
        readableResources: options.readableResources?.(),
      });
    },
  };
}

export function createMcpToolRenderers(label: string): ToolRenderers {
  return {
    renderCall(args, theme, context) {
      const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      component.setText(formatToolCallWithArgs(label, args, theme, context.expanded));
      return component;
    },
    renderResult(result, options, theme, context) {
      const component = (context.lastComponent as Container | undefined) ?? new Container();
      component.clear();
      const output = getTextOutput(result, context.showImages).trim();
      if (!output) return component;
      const color = context.isError ? "error" : "toolOutput";
      const styled = replaceTabs(output)
        .split("\n")
        .map((line) => theme.fg(color, line))
        .join("\n");
      component.addChild(new Spacer(1));
      if (!options.expanded) {
        component.addChild(collapsedOutput(output, "first"));
        return component;
      }
      component.addChild(new Text(styled, 0, 0));
      const fullOutputPath = (result.details as McpToolDetails | undefined)?.fullOutputPath;
      if (fullOutputPath)
        component.addChild(new Text(theme.fg("muted", `Full output: ${fullOutputPath}`), 0, 0));
      return component;
    },
  };
}
