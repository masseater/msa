import type { TSchema } from "typebox";

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
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, relocateEntry(key, value, pointer)]),
  );
}

function relocateEntry(key: string, value: unknown, pointer: string): unknown {
  if (key === "$ref" && typeof value === "string" && (value === "#" || value.startsWith("#/")))
    return `${pointer}${value.slice(1)}`;
  if (SCHEMA_DATA_KEYWORDS.has(key)) return value;
  if (
    SCHEMA_MAP_KEYWORDS.has(key) &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
    return Object.fromEntries(
      Object.entries(value).map(([name, subschema]) => [name, relocateSchema(subschema, pointer)]),
    );
  return relocateSchema(value, pointer);
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

const resultSchema = { createMcpResultSchema };

export default resultSchema;
