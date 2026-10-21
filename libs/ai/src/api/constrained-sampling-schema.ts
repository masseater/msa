import { Data, Function } from "effect";

import type typesModule from "../types.types.ts";
import type constrainedSamplingSchemaTypes from "./constrained-sampling-schema.types.ts";

interface JsonSchemaObject {
  [key: string]: unknown;
  type?: unknown;
  properties?: Record<string, JsonSchemaObject | undefined>;
  required?: unknown;
}

class UnsupportedStrictJsonSchemaError extends Data.TaggedError(
  "UnsupportedStrictJsonSchemaError",
)<{ readonly message: string }> {}

const UNSUPPORTED_STRICT_SCHEMA_KEYS = [
  "$ref",
  "$defs",
  "definitions",
  "allOf",
  "oneOf",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
  "unevaluatedProperties",
  "propertyNames",
  "contains",
  "prefixItems",
  "not",
  "if",
  "then",
  "else",
] as const;

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStructuredSchema(schema: unknown): boolean {
  if (!isJsonSchemaObject(schema)) return false;
  const types =
    typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type : [];
  return (
    types.includes("object") ||
    types.includes("array") ||
    schema.properties !== undefined ||
    schema["items"] !== undefined
  );
}

function schemaAllowsNull(schema: unknown): boolean {
  if (!isJsonSchemaObject(schema)) return false;
  if (schema.type === "null" || (Array.isArray(schema.type) && schema.type.includes("null")))
    return true;
  if (schema["const"] === null || (Array.isArray(schema["enum"]) && schema["enum"].includes(null)))
    return true;
  return (
    Array.isArray(schema["anyOf"]) && schema["anyOf"].some((variant) => schemaAllowsNull(variant))
  );
}

function assertSupportedKeys(
  schema: JsonSchemaObject,
  isUnsupportedKeyword:
    | constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck
    | undefined,
): void {
  for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
    if (schema[key] !== undefined) {
      throw new UnsupportedStrictJsonSchemaError({ message: `${key} schemas are unsupported` });
    }
  }
  if (isUnsupportedKeyword === undefined) return;
  for (const [key, value] of Object.entries(schema)) {
    if (isUnsupportedKeyword(key, value)) {
      throw new UnsupportedStrictJsonSchemaError({
        message: `${key}: ${JSON.stringify(value)} is unsupported`,
      });
    }
  }
}

function assertSupportedUnion(
  schema: JsonSchemaObject,
  isUnsupportedKeyword:
    | constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck
    | undefined,
): void {
  if (schema["anyOf"] === undefined) return;
  if (!Array.isArray(schema["anyOf"]) || schema["anyOf"].length === 0) {
    throw new UnsupportedStrictJsonSchemaError({
      message: "anyOf must contain at least one schema",
    });
  }
  for (const variant of schema["anyOf"]) {
    if (isStructuredSchema(variant)) {
      throw new UnsupportedStrictJsonSchemaError({
        message: "object and array unions are unsupported",
      });
    }
    makeJsonSchemaNodeStrict(variant, isUnsupportedKeyword);
  }
}

function assertSupportedItems(
  schema: JsonSchemaObject,
  isUnsupportedKeyword:
    | constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck
    | undefined,
): void {
  if (schema["items"] === undefined) return;
  if (Array.isArray(schema["items"])) {
    throw new UnsupportedStrictJsonSchemaError({ message: "tuple schemas are unsupported" });
  }
  makeJsonSchemaNodeStrict(schema["items"], isUnsupportedKeyword);
}

function readRequiredNames(schema: JsonSchemaObject): ReadonlyArray<string> {
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))
  ) {
    throw new UnsupportedStrictJsonSchemaError({
      message: "object required must be a string array",
    });
  }
  return Array.isArray(schema.required) ? schema.required : [];
}

function normalizeObjectSchema(
  schema: JsonSchemaObject,
  isUnsupportedKeyword:
    | constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck
    | undefined,
): void {
  if (schema.properties !== undefined && !isJsonSchemaObject(schema.properties)) {
    throw new UnsupportedStrictJsonSchemaError({
      message: "object properties must be a schema map",
    });
  }
  const properties = schema.properties ?? {};
  const propertyNames = Object.keys(properties);
  const required = new Set(readRequiredNames(schema));
  if ([...required].some((key) => !propertyNames.includes(key))) {
    throw new UnsupportedStrictJsonSchemaError({
      message: "required contains an unknown property",
    });
  }
  for (const [key, property] of Object.entries(properties)) {
    makeJsonSchemaNodeStrict(property, isUnsupportedKeyword);
    if (!required.has(key) && !schemaAllowsNull(property)) {
      properties[key] = { anyOf: [property, { type: "null" }] };
    }
  }
  schema.required = propertyNames;
  schema["additionalProperties"] = false;
}

function makeJsonSchemaNodeStrict(
  schema: unknown,
  isUnsupportedKeyword?: constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck,
): void {
  if (!isJsonSchemaObject(schema)) {
    throw new UnsupportedStrictJsonSchemaError({ message: "boolean schemas are unsupported" });
  }
  assertSupportedKeys(schema, isUnsupportedKeyword);
  assertSupportedUnion(schema, isUnsupportedKeyword);
  assertSupportedItems(schema, isUnsupportedKeyword);

  const isObjectSchema = schema.type === "object";
  if (schema.properties !== undefined && !isObjectSchema) {
    throw new UnsupportedStrictJsonSchemaError({ message: "properties require type object" });
  }
  if (!isObjectSchema) return;
  if (schema["additionalProperties"] !== undefined && schema["additionalProperties"] !== false) {
    throw new UnsupportedStrictJsonSchemaError({
      message: "schema-valued or true additionalProperties is unsupported",
    });
  }
  normalizeObjectSchema(schema, isUnsupportedKeyword);
}

const makeStrictJsonSchema: {
  (
    isUnsupportedKeyword?: constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck,
  ): (schema: typesModule.Tool["parameters"]) => Record<string, unknown>;
  (
    schema: typesModule.Tool["parameters"],
    isUnsupportedKeyword?: constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck,
  ): Record<string, unknown>;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null,
  function (
    schema: typesModule.Tool["parameters"],
    isUnsupportedKeyword?: constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck,
  ): Record<string, unknown> {
    const cloned: unknown = structuredClone(schema);
    if (!isJsonSchemaObject(cloned)) {
      throw new UnsupportedStrictJsonSchemaError({ message: "root schema must have type object" });
    }
    makeJsonSchemaNodeStrict(cloned, isUnsupportedKeyword);
    if (cloned.type !== "object") {
      throw new UnsupportedStrictJsonSchemaError({ message: "root schema must have type object" });
    }
    return cloned;
  },
);

const getJsonSchemaToolParameters: {
  (strict: boolean | undefined): (tool: typesModule.Tool) => typesModule.Tool["parameters"];
  (tool: typesModule.Tool, strict: boolean | undefined): typesModule.Tool["parameters"];
} = Function.dual(
  2,
  function (tool: typesModule.Tool, strict: boolean | undefined): typesModule.Tool["parameters"] {
    return (
      strict === true ? makeStrictJsonSchema(tool.parameters) : tool.parameters
    ) as typesModule.Tool["parameters"];
  },
);

const resolveJsonSchemaStrictSampling: {
  (
    supportsStrictMode: boolean,
    isUnsupportedKeyword?: constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck,
  ): (tool: typesModule.Tool) => boolean | undefined;
  (
    tool: typesModule.Tool,
    supportsStrictMode: boolean,
    isUnsupportedKeyword?: constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck,
  ): boolean | undefined;
} = Function.dual(
  (args) => typeof args[0] === "object" && args[0] !== null,
  function (
    tool: typesModule.Tool,
    supportsStrictMode: boolean,
    isUnsupportedKeyword?: constrainedSamplingSchemaTypes.UnsupportedStrictSchemaKeywordCheck,
  ): boolean | undefined {
    const config = tool.constrainedSampling;
    if (config === undefined || config === false || config.type !== "json_schema") return undefined;

    if (supportsStrictMode) {
      try {
        makeStrictJsonSchema(tool.parameters, isUnsupportedKeyword);
        return true;
      } catch (error) {
        if (!(error instanceof UnsupportedStrictJsonSchemaError)) throw error;
        if (config.strict !== "require") return undefined;
        throw new Error(
          `Tool "${tool.name}" requires JSON-schema constrained sampling, but ${error.message}.`,
          { cause: error },
        );
      }
    }
    if (config.strict === "require") {
      throw new Error(
        `Tool "${tool.name}" requires JSON-schema constrained sampling, but strict tools are unsupported.`,
      );
    }
    return undefined;
  },
);

const constrainedSamplingSchema = {
  getJsonSchemaToolParameters,
  makeStrictJsonSchema,
  resolveJsonSchemaStrictSampling,
};

export default constrainedSamplingSchema;
