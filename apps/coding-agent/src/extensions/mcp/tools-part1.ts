import type aiTypes from "@msa/ai/index.types";
import { dual } from "effect/Function";
import type { TSchema } from "typebox";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import platformNode from "../../core/platform-node.ts";
import outputFiles from "../../utils/output-files.ts";
import type configTypes from "./config.types.ts";

const { writeOutputFile } = outputFiles;
const { sha256Hex } = platformNode;

function toToolExposure(exposure: configTypes.McpExposure): extensionsTypesTypes.ToolExposure {
  return exposure === "codemode" ? "deferred" : exposure;
}

const MAX_TOOL_NAME_LENGTH = 64;

const MCP_OUTPUT_MAX_BYTES = 20 * 1024;

function saveToTempFile(data: string | Uint8Array, extension: string): Promise<string> {
  return writeOutputFile("msa-mcp", extension, data);
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

const createMcpToolName: {
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

function createMcpResultSchema(
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

const toolsPart1 = {
  MCP_OUTPUT_MAX_BYTES,
  createMcpResultSchema,
  createMcpToolName,
  saveToTempFile,
  textOf,
  toToolExposure,
};

export default toolsPart1;
