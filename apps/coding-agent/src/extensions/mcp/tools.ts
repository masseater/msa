import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import type { TSchema } from "typebox";

import { awaited, awaiting } from "../../core/awaiting.ts";
import type {
  ToolAnnotations,
  ToolDefinition,
  ToolExposure,
  ToolNamespace,
  ToolRenderers,
} from "../../core/extensions/types.ts";
import { READ_MCP_RESOURCE_TOOL } from "../../core/mcp-servers.ts";
import { sha256Hex } from "../../core/platform-node.ts";
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

const { Container, Spacer, Text } = tui;

const { toLlmContent } = mcp;

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

function saveToTempFile(data: string | Uint8Array, extension: string): Promise<string> {
  return writeOutputFile("msa-mcp", extension, data);
}

export interface McpToolCaller {
  callTool(
    name: string,
    args: Record<string, unknown>,
    options: mcpTypes.McpRequestOptions,
  ): Promise<mcpTypes.CallToolResult>;
}

function createMcpToolNameImpl(
  server: string,
  tool: string,
  isTaken: (name: string) => boolean = () => false,
): string {
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/gu, "_");
  if (name.length <= MAX_TOOL_NAME_LENGTH && !isTaken(name)) return name;
  const hash = sha256Hex(`${server}\0${tool}`).slice(0, 8);
  return `${name.slice(0, MAX_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

export const createMcpToolName: {
  (server: string, tool: string, isTaken?: (name: string) => boolean): string;
  (tool: string, isTaken?: (name: string) => boolean): (server: string) => string;
} = dual((args: IArguments) => args.length >= 2, createMcpToolNameImpl);

function textOf(content: readonly (aiTypes.TextContent | aiTypes.ImageContent)[]): string {
  return content
    .filter((block): block is aiTypes.TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const CONTENT_BLOCK_SCHEMA = {
  additionalProperties: true,
  properties: {
    data: { type: "string" },
    mimeType: { type: "string" },
    text: { type: "string" },
    type: { enum: ["text", "image", "audio", "resource_link", "resource"] },
  },
  required: ["type"],
  type: "object",
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
    additionalProperties: true,
    properties: {
      content: { items: CONTENT_BLOCK_SCHEMA, type: "array" },

      isError: { type: "boolean" },

      structuredContent:
        structuredContentSchema === undefined
          ? {}
          : relocateSchema(structuredContentSchema, "#/properties/structuredContent"),
    },
    required: ["content"],
    type: "object",
  } as unknown as TSchema;
}

function limitMcpContentImpl(
  content: (aiTypes.TextContent | aiTypes.ImageContent)[],
  saveOutput: McpOutputSaver = saveToTempFile,
): Promise<{ content: (aiTypes.TextContent | aiTypes.ImageContent)[]; fullOutputPath?: string }> {
  return Effect.runPromise(
    awaiting(function* () {
      const combined = textOf(content);
      const truncation = truncateMiddle(combined, MCP_OUTPUT_MAX_BYTES);
      if (!truncation.truncated) return { content };
      let fullOutputPath: string | undefined;
      let where: string;
      try {
        fullOutputPath = yield* awaited(saveOutput(combined, ".txt"));
        where = `[Full output: ${fullOutputPath} (read it with offset/limit)]`;
      } catch (error) {
        where = `[Could not save the full output: ${toErrorMessage(error)}]`;
      }
      const tokens = Math.ceil(truncation.totalBytes / 4);
      const text = `Warning: truncated output (original token count: ${tokens})\nTotal output lines: ${truncation.totalLines}\n\n${truncation.content}\n\n${where}`;
      return {
        content: [{ text, type: "text" }, ...content.filter((block) => block.type === "image")],
        ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
      };
    }),
  );
}

export const limitMcpContent: {
  (
    content: (aiTypes.TextContent | aiTypes.ImageContent)[],
    saveOutput?: McpOutputSaver,
  ): Promise<{ content: (aiTypes.TextContent | aiTypes.ImageContent)[]; fullOutputPath?: string }>;
  (saveOutput?: McpOutputSaver): (
    content: (aiTypes.TextContent | aiTypes.ImageContent)[],
  ) => Promise<{
    content: (aiTypes.TextContent | aiTypes.ImageContent)[];
    fullOutputPath?: string;
  }>;
} = dual((args: IArguments) => args.length >= 1, limitMcpContentImpl);

export interface ConvertMcpResultOptions {
  saveOutput?: McpOutputSaver | undefined;

  readableResources?: boolean | undefined;
}

function extensionOf(uri: string): string {
  const path = URL.canParse(uri) ? new URL(uri).pathname : uri;
  return /\.[A-Za-z0-9]{1,8}$/u.exec(path)?.[0] ?? ".bin";
}

function isTextMimeType(mimeType: string | undefined): boolean {
  if (mimeType === undefined || mimeType === "") return false;
  const type = (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase();
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  );
}

function blockToContent(
  server: string,
  block: mcpTypes.ContentBlock,
  options: ConvertMcpResultOptions,
): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> {
  return Effect.runPromise(
    awaiting(function* () {
      if (block.type === "resource_link") {
        const details = [
          block.mimeType,
          block.size === undefined ? undefined : formatSize(block.size),
        ].filter(Boolean);
        const read =
          options.readableResources === true
            ? `. Read it with ${READ_MCP_RESOURCE_TOOL} (server "${server}")`
            : "";
        const description =
          block.description !== undefined && block.description !== ""
            ? `: ${block.description}`
            : "";
        return [
          {
            text: `[Resource ${block.uri} "${block.title ?? block.name}"${details.length > 0 ? ` (${details.join(", ")})` : ""}${description}${read}]`,
            type: "text",
          },
        ];
      }
      if (
        block.type === "resource" &&
        "blob" in block.resource &&
        block.resource.mimeType?.startsWith("image/") !== true
      ) {
        const { uri, mimeType, blob } = block.resource;
        const data = Buffer.from(blob, "base64");
        if (isTextMimeType(mimeType)) return [{ text: data.toString("utf8"), type: "text" }];
        const kind = `${mimeType ?? "unknown type"}, ${formatSize(data.length)}`;
        try {
          const path = yield* awaited(
            (options.saveOutput ?? saveToTempFile)(data, extensionOf(uri)),
          );
          return [{ text: `[Binary resource ${uri} (${kind}) saved to ${path}]`, type: "text" }];
        } catch (error) {
          const reason = toErrorMessage(error);
          return [
            {
              text: `[Binary resource ${uri} (${kind}) could not be saved: ${reason}]`,
              type: "text",
            },
          ];
        }
      }
      return toLlmContent({ content: [block] });
    }),
  );
}

function toModelContentImpl(
  server: string,
  blocks: readonly mcpTypes.ContentBlock[],
  options: ConvertMcpResultOptions = {},
): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> {
  return Effect.runPromise(
    awaiting(function* () {
      return (yield* awaited(
        Promise.all(blocks.map((block) => blockToContent(server, block, options))),
      )).flat();
    }),
  );
}

export const toModelContent: {
  (
    server: string,
    blocks: readonly mcpTypes.ContentBlock[],
    options?: ConvertMcpResultOptions,
  ): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]>;
  (
    blocks: readonly mcpTypes.ContentBlock[],
    options?: ConvertMcpResultOptions,
  ): (server: string) => Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]>;
} = dual((args: IArguments) => args.length >= 2, toModelContentImpl);

function convertMcpResultImpl(
  server: string,
  tool: string,
  result: mcpTypes.CallToolResult,
  options: ConvertMcpResultOptions = {},
): Promise<agentTypes.AgentToolResult<McpToolDetails>> {
  return Effect.runPromise(
    awaiting(function* () {
      const converted: (aiTypes.TextContent | aiTypes.ImageContent)[] =
        result.content.length > 0
          ? yield* awaited(toModelContent(server, result.content, options))
          : toLlmContent(result);
      if (result.isError === true && textOf(converted) === "") {
        converted.push({ text: `MCP tool ${server}/${tool} returned an error`, type: "text" });
      }
      const { content, fullOutputPath } = yield* awaited(
        limitMcpContent(converted, options.saveOutput),
      );
      const { _meta: _ignored, ...scriptResult } = result;
      return {
        content,
        details: {
          server,
          tool,
          ...(fullOutputPath !== undefined && fullOutputPath !== "" ? { fullOutputPath } : {}),
        },
        structuredContent: scriptResult as unknown as aiTypes.JsonValue,
        ...(result.isError === true ? { isError: true } : {}),
      };
    }),
  );
}

export const convertMcpResult: {
  (
    server: string,
    tool: string,
    result: mcpTypes.CallToolResult,
    options?: ConvertMcpResultOptions,
  ): Promise<agentTypes.AgentToolResult<McpToolDetails>>;
  (
    tool: string,
    result: mcpTypes.CallToolResult,
    options?: ConvertMcpResultOptions,
  ): (server: string) => Promise<agentTypes.AgentToolResult<McpToolDetails>>;
} = dual((args: IArguments) => args.length >= 3, convertMcpResultImpl);

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

function toToolAnnotations(tool: mcpTypes.Tool): ToolAnnotations | undefined {
  const annotations: ToolAnnotations = {};
  for (const hint of ANNOTATION_HINTS) {
    const value = tool.annotations?.[hint];
    if (typeof value === "boolean") annotations[hint] = value;
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

export function createMcpToolDefinition(options: {
  server: string;
  tool: mcpTypes.Tool;
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
    ...(annotations === undefined ? {} : { annotations }),
    ...createMcpToolRenderers(label),
    execute(_toolCallId, params, signal, onUpdate) {
      return Effect.runPromise(
        awaiting(function* () {
          const client = yield* awaited(options.getClient());
          const result = yield* awaited(
            client.callTool(tool.name, (params ?? {}) as Record<string, unknown>, {
              ...(signal === undefined ? {} : { signal }),
              onProgress: (progress) => {
                const total = progress.total === undefined ? "" : `/${progress.total}`;
                const text = progress.message ?? `Progress ${progress.progress}${total}`;
                onUpdate?.({
                  content: [{ type: "text", text }],
                  details: { server, tool: tool.name },
                });
              },
              timeoutMs: options.timeoutMs,
            }),
          );
          return yield* awaited(
            convertMcpResult(server, tool.name, result, {
              readableResources: options.readableResources?.(),
            }),
          );
        }),
      );
    },
  };
}

export function createMcpToolRenderers(label: string): ToolRenderers {
  return {
    renderCall(args, theme, context) {
      const component = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
      component.setText(formatToolCallWithArgs(label, args, theme, context.expanded));
      return component;
    },
    renderResult(result, options, theme, context) {
      const component =
        (context.lastComponent as tuiTypes.Container | undefined) ?? new Container();
      component.clear();
      const output = getTextOutput(result, context.showImages).trim();
      if (output === "") return component;
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
      if (fullOutputPath !== undefined && fullOutputPath !== "")
        component.addChild(new Text(theme.fg("muted", `Full output: ${fullOutputPath}`), 0, 0));
      return component;
    },
  };
}
