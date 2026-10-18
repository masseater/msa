import { Function } from "effect";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { Value } from "typebox/value";

import type { Tool, ToolCall } from "../types.ts";

type SchemaValidator = ReturnType<typeof Compile>;

const validatorCache = new WeakMap<object, SchemaValidator>();
const TYPEBOX_KIND = Symbol.for("TypeBox.Kind");

interface JsonSchemaObject {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject | JsonSchemaObject[];
  additionalProperties?: boolean | JsonSchemaObject;
  allOf?: JsonSchemaObject[];
  anyOf?: JsonSchemaObject[];
  oneOf?: JsonSchemaObject[];
}

function getSchemaTypes(schema: JsonSchemaObject): string[] {
  if (typeof schema.type === "string") return [schema.type];
  if (!Array.isArray(schema.type)) return [];
  return schema.type.filter((type): type is string => typeof type === "string");
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const JSON_TYPE_CHECKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  number: (value) => typeof value === "number",
  integer: (value) => typeof value === "number" && Number.isInteger(value),
  boolean: (value) => typeof value === "boolean",
  string: (value) => typeof value === "string",
  null: (value) => value === null,
  array: Array.isArray,
  object: isJsonObject,
};

function matchesJsonType(value: unknown, type: string): boolean {
  return Object.hasOwn(JSON_TYPE_CHECKS, type) && JSON_TYPE_CHECKS[type]!(value);
}

function getValidator(schema: object): SchemaValidator {
  const cached = validatorCache.get(schema);
  if (cached !== undefined) return cached;
  const validator = Compile(schema as Tool["parameters"]);
  validatorCache.set(schema, validator);
  return validator;
}

function subSchemaAccepts(schema: JsonSchemaObject, value: unknown): boolean {
  try {
    return getValidator(schema).Check(value);
  } catch {
    return false;
  }
}

function coerceNumeric(value: unknown, accepts: (parsed: number) => boolean): unknown {
  if (value === null) return 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (accepts(parsed)) return parsed;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

const BOOLEAN_STRINGS: Readonly<Record<string, boolean>> = { true: true, false: false };
const BOOLEAN_NUMBERS: Readonly<Record<number, boolean>> = { 1: true, 0: false };

function coerceBoolean(value: unknown): unknown {
  if (value === null) return false;
  if (typeof value === "string" && Object.hasOwn(BOOLEAN_STRINGS, value)) {
    return BOOLEAN_STRINGS[value];
  }
  if (typeof value === "number" && Object.hasOwn(BOOLEAN_NUMBERS, value)) {
    return BOOLEAN_NUMBERS[value];
  }
  return value;
}

function coerceString(value: unknown): unknown {
  if (value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value;
}

const PRIMITIVE_COERCIONS: Readonly<Record<string, (value: unknown) => unknown>> = {
  number: (value) => coerceNumeric(value, Number.isFinite),
  integer: (value) => coerceNumeric(value, Number.isInteger),
  boolean: coerceBoolean,
  string: coerceString,
  null: (value) => (value === "" || value === 0 || value === false ? null : value),
};

function coercePrimitiveByType(value: unknown, type: string): unknown {
  return Object.hasOwn(PRIMITIVE_COERCIONS, type) ? PRIMITIVE_COERCIONS[type]!(value) : value;
}

function applySchemaObjectCoercion(value: Record<string, unknown>, schema: JsonSchemaObject): void {
  const properties = schema.properties ?? {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (key in value) value[key] = coerceWithJsonSchema(value[key], propertySchema);
  }
  const additional = schema.additionalProperties;
  if (typeof additional !== "object") return;
  for (const [key, propertyValue] of Object.entries(value)) {
    if (!Object.hasOwn(properties, key)) {
      value[key] = coerceWithJsonSchema(propertyValue, additional);
    }
  }
}

function applySchemaArrayCoercion(value: unknown[], schema: JsonSchemaObject): void {
  const { items } = schema;
  if (items === undefined) return;
  for (let index = 0; index < value.length; index++) {
    const itemSchema = Array.isArray(items) ? items[index] : items;
    if (itemSchema !== undefined) value[index] = coerceWithJsonSchema(value[index], itemSchema);
  }
}

function coerceWithUnionSchema(value: unknown, schemas: JsonSchemaObject[]): unknown {
  if (schemas.some((schema) => subSchemaAccepts(schema, value))) return value;
  for (const schema of schemas) {
    const coerced = coerceWithJsonSchema(structuredClone(value), schema);
    if (subSchemaAccepts(schema, coerced)) return coerced;
  }
  return value;
}

function coerceToSchemaTypes(value: unknown, schemaTypes: readonly string[]): unknown {
  const matchesUnionMember =
    schemaTypes.length > 1 && schemaTypes.some((schemaType) => matchesJsonType(value, schemaType));
  if (matchesUnionMember) return value;
  for (const schemaType of schemaTypes) {
    const candidate = coercePrimitiveByType(value, schemaType);
    if (candidate !== value) return candidate;
  }
  return value;
}

function coerceWithJsonSchema(value: unknown, schema: JsonSchemaObject): unknown {
  let nextValue = value;
  for (const nested of Array.isArray(schema.allOf) ? schema.allOf : [])
    nextValue = coerceWithJsonSchema(nextValue, nested);
  if (Array.isArray(schema.anyOf)) nextValue = coerceWithUnionSchema(nextValue, schema.anyOf);
  if (Array.isArray(schema.oneOf)) nextValue = coerceWithUnionSchema(nextValue, schema.oneOf);

  const schemaTypes = getSchemaTypes(schema);
  nextValue = coerceToSchemaTypes(nextValue, schemaTypes);
  if (schemaTypes.includes("object") && isJsonObject(nextValue)) {
    applySchemaObjectCoercion(nextValue, schema);
  }
  if (schemaTypes.includes("array") && Array.isArray(nextValue)) {
    applySchemaArrayCoercion(nextValue, schema);
  }
  return nextValue;
}

function isDroppableNull(value: unknown, propertySchema: JsonSchemaObject): boolean {
  if (value !== null || typeof (propertySchema as { $ref?: unknown }).$ref === "string") {
    return false;
  }
  try {
    return !getValidator(propertySchema).Check(null);
  } catch {
    return false;
  }
}

function normalizeOptionalNulls(value: unknown, schema: JsonSchemaObject): void {
  if (Array.isArray(value)) {
    const { items } = schema;
    if (items === undefined) return;
    value.forEach((item, index) => {
      const itemSchema = Array.isArray(items) ? items[index] : items;
      if (itemSchema !== undefined) normalizeOptionalNulls(item, itemSchema);
    });
    return;
  }
  if (typeof value !== "object" || value === null || schema.properties === undefined) return;

  const object = value as Record<string, unknown>;
  const required = new Set(schema.required ?? []);
  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    if (!(key in object)) continue;
    if (!required.has(key) && isDroppableNull(object[key], propertySchema)) {
      delete object[key];
    } else {
      normalizeOptionalNulls(object[key], propertySchema);
    }
  }
}

function formatValidationPath(error: TLocalizedValidationError): string {
  const path = error.instancePath.replace(/^\//u, "").replace(/\//gu, ".");
  const requiredProperty =
    error.keyword === "required"
      ? (error.params as { requiredProperties?: string[] }).requiredProperties?.[0]
      : undefined;
  if (requiredProperty === undefined || requiredProperty === "") return path || "root";
  return path === "" ? requiredProperty : `${path}.${requiredProperty}`;
}

export const validateToolCall: {
  (toolCall: ToolCall): (tools: Tool[]) => any;
  (tools: Tool[], toolCall: ToolCall): any;
} = Function.dual(2, function (tools: Tool[], toolCall: ToolCall): any {
  const tool = tools.find((t) => t.name === toolCall.name);
  if (tool === undefined) {
    throw new Error(`Tool "${toolCall.name}" not found`);
  }
  return validateToolArguments(tool, toolCall);
});

export const validateToolArguments: {
  (toolCall: ToolCall): (tool: Tool) => any;
  (tool: Tool, toolCall: ToolCall): any;
} = Function.dual(2, function (tool: Tool, toolCall: ToolCall): any {
  if (toolCall.argumentsError !== undefined && toolCall.argumentsError !== "") {
    throw new Error(`Invalid arguments for tool "${toolCall.name}": ${toolCall.argumentsError}`);
  }
  const args = structuredClone(toolCall.arguments);
  normalizeOptionalNulls(args, tool.parameters as JsonSchemaObject);
  Value.Convert(tool.parameters, args);

  const validator = getValidator(tool.parameters);
  if (!Object.getOwnPropertySymbols(tool.parameters).includes(TYPEBOX_KIND)) {
    const coerced = coerceWithJsonSchema(args, tool.parameters as JsonSchemaObject);
    if (coerced !== args) {
      if (
        typeof args === "object" &&
        args !== null &&
        typeof coerced === "object" &&
        coerced !== null
      ) {
        for (const key of Object.keys(args)) {
          delete args[key];
        }
        Object.assign(args, coerced);
      } else {
        return validator.Check(coerced) ? coerced : args;
      }
    }
  }

  if (validator.Check(args)) {
    return args;
  }

  const errors =
    validator
      .Errors(args)
      .map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
      .join("\n") || "Unknown validation error";

  const errorMessage = `Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(toolCall.arguments, null, 2)}`;

  throw new Error(errorMessage);
});
