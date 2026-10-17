import { Data, Function } from "effect";

import type { Tool } from "../types.ts";
import { toErrorMessage } from "../utils/errors.ts";

interface JsonSchemaObject {
  [key: string]: unknown;
  type?: unknown;
  properties?: Record<string, JsonSchemaObject | undefined>;
  required?: unknown;
}

class UnsupportedStrictJsonSchemaError extends Data.TaggedError(
  "UnsupportedStrictJsonSchemaError",
)<{ readonly message: string }> {}

export type UnsupportedStrictSchemaKeywordCheck = (key: string, value: unknown) => boolean;

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

function makeJsonSchemaNodeStrict(
  schema: unknown,
  isUnsupportedKeyword?: UnsupportedStrictSchemaKeywordCheck,
): void {
  if (!isJsonSchemaObject(schema)) {
    throw new UnsupportedStrictJsonSchemaError({ message: "boolean schemas are unsupported" });
  }
  for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
    if (schema[key] !== undefined) {
      throw new UnsupportedStrictJsonSchemaError({ message: `${key} schemas are unsupported` });
    }
  }
  if (isUnsupportedKeyword !== undefined) {
    for (const [key, value] of Object.entries(schema)) {
      if (isUnsupportedKeyword(key, value)) {
        throw new UnsupportedStrictJsonSchemaError({
          message: `${key}: ${JSON.stringify(value)} is unsupported`,
        });
      }
    }
  }

  if (schema["anyOf"] !== undefined) {
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

  if (schema["items"] !== undefined) {
    if (Array.isArray(schema["items"])) {
      throw new UnsupportedStrictJsonSchemaError({ message: "tuple schemas are unsupported" });
    }
    makeJsonSchemaNodeStrict(schema["items"], isUnsupportedKeyword);
  }

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
  if (schema.properties !== undefined && !isJsonSchemaObject(schema.properties)) {
    throw new UnsupportedStrictJsonSchemaError({
      message: "object properties must be a schema map",
    });
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== "string"))
  ) {
    throw new UnsupportedStrictJsonSchemaError({
      message: "object required must be a string array",
    });
  }

  const properties = schema.properties ?? {};
  const propertyNames = Object.keys(properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
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

export function makeStrictJsonSchema(
  schema: Tool["parameters"],
  isUnsupportedKeyword?: UnsupportedStrictSchemaKeywordCheck,
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
}

export const getJsonSchemaToolParameters: {
  (strict: boolean | undefined): (tool: Tool) => Tool["parameters"];
  (tool: Tool, strict: boolean | undefined): Tool["parameters"];
} = Function.dual(2, function (tool: Tool, strict: boolean | undefined): Tool["parameters"] {
  return (
    strict === true ? makeStrictJsonSchema(tool.parameters) : tool.parameters
  ) as Tool["parameters"];
});

export interface GrammarConstrainedSampling {
  format: "lark" | "regex";
  definition: string;
  inputProperty: string;
}

export interface GrammarToolInputJsonBuffer {
  input: string;
  started: boolean;
  closed: boolean;
}

export const getGrammarToolInput: {
  (arguments_: Record<string, unknown>, inputProperty: string): (toolName: string) => string;
  (toolName: string, arguments_: Record<string, unknown>, inputProperty: string): string;
} = Function.dual(
  3,
  function (toolName: string, arguments_: Record<string, unknown>, inputProperty: string): string {
    const input = arguments_[inputProperty];
    if (typeof input !== "string") {
      throw new Error(
        `Grammar tool call "${toolName}" requires argument "${inputProperty}" to be a string.`,
      );
    }
    return input;
  },
);

export const appendGrammarToolInputJsonDelta: {
  (
    inputProperty: string,
    nextInput: string,
    close: boolean,
  ): (buffer: GrammarToolInputJsonBuffer) => string | undefined;
  (
    buffer: GrammarToolInputJsonBuffer,
    inputProperty: string,
    nextInput: string,
    close: boolean,
  ): string | undefined;
} = Function.dual(
  4,
  function (
    buffer: GrammarToolInputJsonBuffer,
    inputProperty: string,
    nextInput: string,
    close: boolean,
  ): string | undefined {
    if (buffer.closed) {
      if (close && nextInput === buffer.input) return undefined;
      throw new Error(
        `grammar tool input for property "${inputProperty}" changed after it was closed`,
      );
    }
    if (!nextInput.startsWith(buffer.input)) {
      throw new Error(
        `grammar tool input for property "${inputProperty}" changed non-monotonically`,
      );
    }

    const inputDelta = nextInput.slice(buffer.input.length);
    if (!close && inputDelta.length === 0) return undefined;

    let delta = "";
    if (!buffer.started) {
      delta += `{${JSON.stringify(inputProperty)}:"`;
      buffer.started = true;
    }
    delta += JSON.stringify(inputDelta).slice(1, -1);
    buffer.input = nextInput;

    if (close) {
      delta += '"}';
      buffer.closed = true;
    }
    return delta;
  },
);

function inferGrammarInputProperty(tool: Tool): string {
  const schema = tool.parameters as JsonSchemaObject;
  if (schema.type !== "object") {
    throw new Error("grammar constrained sampling requires an object parameter schema");
  }
  if (
    !Array.isArray(schema.required) ||
    schema.required.length !== 1 ||
    typeof schema.required[0] !== "string"
  ) {
    throw new Error("grammar constrained sampling requires exactly one required string property");
  }

  const inputProperty = schema.required[0];
  if (schema.properties?.[inputProperty] === undefined) {
    throw new Error(
      `grammar constrained sampling requires a properties entry for ${inputProperty}`,
    );
  }
  if (schema.properties[inputProperty]?.type !== "string") {
    throw new Error(`grammar constrained sampling property ${inputProperty} must have type string`);
  }
  return inputProperty;
}

export function resolveJsonSchemaStrictSampling(
  tool: Tool,
  supportsStrictMode: boolean,
  isUnsupportedKeyword?: UnsupportedStrictSchemaKeywordCheck,
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
}

export const resolveGrammarConstrainedSampling: {
  (supportsOpenAIGrammarTools: boolean): (tool: Tool) => GrammarConstrainedSampling | undefined;
  (tool: Tool, supportsOpenAIGrammarTools: boolean): GrammarConstrainedSampling | undefined;
} = Function.dual(2, function (tool: Tool, supportsOpenAIGrammarTools: boolean):
  | GrammarConstrainedSampling
  | undefined {
  const config = tool.constrainedSampling;
  if (config === undefined || config === false || config.type !== "grammar") {
    return undefined;
  }

  if (!supportsOpenAIGrammarTools) {
    return undefined;
  }

  const larkDefinition = config.variants.openai_lark;
  const regexDefinition = config.variants.openai_regex;
  const hasLarkDefinition = typeof larkDefinition === "string" && larkDefinition.trim().length > 0;
  const hasRegexDefinition =
    typeof regexDefinition === "string" && regexDefinition.trim().length > 0;
  if (!hasLarkDefinition && !hasRegexDefinition) {
    throw new Error(
      `Tool "${tool.name}" cannot use grammar constrained sampling: no supported grammar variant was provided.`,
    );
  }

  try {
    return {
      format: hasLarkDefinition ? "lark" : "regex",
      definition: hasLarkDefinition ? larkDefinition : regexDefinition!,
      inputProperty: inferGrammarInputProperty(tool),
    };
  } catch (error) {
    const message = toErrorMessage(error);
    throw new Error(`Tool "${tool.name}" cannot use grammar constrained sampling: ${message}.`, {
      cause: error,
    });
  }
});

export const createGrammarToolInputProperties: {
  (supportsOpenAIGrammarTools: boolean): (tools: Tool[] | undefined) => ReadonlyMap<string, string>;
  (tools: Tool[] | undefined, supportsOpenAIGrammarTools: boolean): ReadonlyMap<string, string>;
} = Function.dual(
  2,
  function (
    tools: Tool[] | undefined,
    supportsOpenAIGrammarTools: boolean,
  ): ReadonlyMap<string, string> {
    const properties = new Map<string, string>();
    for (const tool of tools ?? []) {
      const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);
      if (grammar !== undefined) {
        properties.set(tool.name, grammar.inputProperty);
      }
    }
    return properties;
  },
);
