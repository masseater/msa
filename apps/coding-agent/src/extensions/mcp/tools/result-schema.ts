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

const resultSchema = { createMcpResultSchema };

export default resultSchema;
