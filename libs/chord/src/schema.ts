import { dual } from "effect/Function";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

import errorsModule from "./errors.ts";
import type errorsTypes from "./errors.types.ts";

const { invalid } = errorsModule;

type Schema = { readonly [key: string]: unknown };

const asSchema = (schema: unknown): Schema =>
  schema !== null && typeof schema === "object"
    ? (schema as Schema)
    : schema === false
      ? { not: {} }
      : {};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(value)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

const deepEqual: {
  (b: unknown): (a: unknown) => boolean;
  (a: unknown, b: unknown): boolean;
} = dual(2, (a: unknown, b: unknown): boolean => a === b || canonicalJson(a) === canonicalJson(b));

function checkValid(
  reason: errorsTypes.ChordErrorReason,
  what: string,
  schema: TSchema,
  value: unknown,
): void {
  if (Value.Check(schema, value)) return;
  const errors = [...Value.Errors(schema, value)].slice(0, 3);
  const summary = errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
  throw invalid(reason, `${what}: ${summary}`, errors);
}

function normalized(schema: TSchema, value: unknown, what: string): unknown {
  const clean = Value.Clean(schema, Value.Default(schema, Value.Clone(value ?? {})));
  assertValid("input", what, schema, clean);
  return clean;
}

const canonicalIdentity: {
  (value: unknown): (schema: TSchema) => string;
  (schema: TSchema, value: unknown): string;
} = dual(2, (schema: TSchema, value: unknown): string =>
  canonicalJson(stripDefaults(asSchema(schema), value)),
);

const assertValid: {
  (what: string, schema: TSchema, value: unknown): (reason: errorsTypes.ChordErrorReason) => void;
  (reason: errorsTypes.ChordErrorReason, what: string, schema: TSchema, value: unknown): void;
} = dual(4, checkValid);

const normalize: {
  (value: unknown, what: string): (schema: TSchema) => unknown;
  (schema: TSchema, value: unknown, what: string): unknown;
} = dual(3, normalized);

function stripDefaults(schema: Schema, value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = schema["items"];
    if (Array.isArray(items))
      return value.map((item, index) => stripDefaults(asSchema(items[index]), item));
    return value.map((item) => stripDefaults(asSchema(items), item));
  }
  if (value === null || typeof value !== "object") return value;
  const properties = asSchema(schema["properties"]);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const property = asSchema(properties[key]);
    if ("default" in property && deepEqual(property["default"], item)) continue;
    result[key] = stripDefaults(property, item);
  }
  return result;
}

const CONSTRAINTS = [
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
] as const;

const typesOf = (schema: Schema): string[] | undefined =>
  typeof schema["type"] === "string"
    ? [schema["type"]]
    : Array.isArray(schema["type"])
      ? (schema["type"] as string[])
      : undefined;

const KNOWN: ReadonlySet<string> = new Set([
  ...CONSTRAINTS,
  "type",
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "items",
  "additionalItems",
  "const",
  "enum",
  "anyOf",
  "parameters",
  "returnType",
]);

const ANNOTATIONS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "default",
  "examples",
  "$id",
  "$schema",
  "$comment",
  "readOnly",
  "writeOnly",
  "deprecated",
]);

const withoutAnnotations = (schema: Schema): Schema =>
  Object.fromEntries(Object.entries(schema).filter(([key]) => !ANNOTATIONS.has(key)));

function schemaFits(subSchema: unknown, supSchema: unknown): boolean {
  const sub = withoutAnnotations(asSchema(subSchema));
  const sup = withoutAnnotations(asSchema(supSchema));
  if (Object.keys(sup).length === 0) return true;
  if (deepEqual(sub, sup)) return true;
  if (Object.keys(sup).some((key) => !KNOWN.has(key))) return false;
  if (sup["additionalProperties"] !== undefined && typeof sup["additionalProperties"] !== "boolean")
    return false;
  if (Array.isArray(sub["anyOf"])) return sub["anyOf"].every((branch) => fits(branch, sup));
  if (Array.isArray(sup["anyOf"])) return sup["anyOf"].some((branch) => fits(sub, branch));
  if ("const" in sup) return "const" in sub && deepEqual(sub["const"], sup["const"]);
  if (Array.isArray(sup["enum"])) {
    const values =
      "const" in sub ? [sub["const"]] : Array.isArray(sub["enum"]) ? sub["enum"] : undefined;
    return (
      values?.every((item) =>
        (sup["enum"] as unknown[]).some((allowed) => deepEqual(allowed, item)),
      ) ?? false
    );
  }
  for (const key of CONSTRAINTS) if (key in sup && !deepEqual(sub[key], sup[key])) return false;
  const supTypes = typesOf(sup);
  const subTypes = typesOf(sub);
  if (supTypes === undefined || subTypes === undefined) return false;
  if (
    !subTypes.every(
      (type) => supTypes.includes(type) || (type === "integer" && supTypes.includes("number")),
    )
  ) {
    return false;
  }
  if ("const" in sub || Array.isArray(sub["enum"])) return true;
  if (subTypes.includes("object") && !objectFits(sub, sup)) return false;
  if (subTypes.includes("array") && !arrayFits(sub, sup)) return false;
  if (subTypes.includes("function")) return functionFits(sub, sup);
  return true;
}

function objectFits(sub: Schema, sup: Schema): boolean {
  const subProperties = asSchema(sub["properties"]);
  const supProperties = asSchema(sup["properties"]);
  const subRequired = new Set((sub["required"] as string[] | undefined) ?? []);
  for (const key of (sup["required"] as string[] | undefined) ?? [])
    if (!subRequired.has(key)) return false;
  for (const [key, property] of Object.entries(supProperties)) {
    if (key in subProperties) {
      if (!fits(subProperties[key], property)) return false;
    } else if (
      typeof sub["additionalProperties"] === "object" &&
      !fits(sub["additionalProperties"], property)
    ) {
      return false;
    }
  }
  if (sup["additionalProperties"] === false) {
    if (sub["additionalProperties"] !== false) return false;
    if (Object.keys(subProperties).some((key) => !(key in supProperties))) return false;
  }
  const supPatterns = asSchema(sup["patternProperties"]);
  if (Object.keys(supPatterns).length > 0) {
    const subPatterns = asSchema(sub["patternProperties"]);
    if (sub["additionalProperties"] !== false && Object.keys(subPatterns).length === 0)
      return false;
    for (const [pattern, property] of Object.entries(supPatterns)) {
      const matcher = new RegExp(pattern, "u");
      for (const [key, subProperty] of Object.entries(subProperties)) {
        if (!(key in supProperties) && matcher.test(key) && !fits(subProperty, property))
          return false;
      }
      if (
        Object.keys(subPatterns).length > 0 &&
        (!(pattern in subPatterns) || !fits(subPatterns[pattern], property))
      ) {
        return false;
      }
    }
    for (const pattern of Object.keys(subPatterns)) if (!(pattern in supPatterns)) return false;
  }
  return true;
}

function arrayFits(sub: Schema, sup: Schema): boolean {
  if (Array.isArray(sup["items"])) {
    if (!Array.isArray(sub["items"]) || sub["items"].length !== sup["items"].length) return false;
    return sub["items"].every((item, index) => fits(item, (sup["items"] as unknown[])[index]));
  }
  if (Array.isArray(sub["items"])) return sub["items"].every((item) => fits(item, sup["items"]));
  return fits(sub["items"], sup["items"]);
}

function functionFits(sub: Schema, sup: Schema): boolean {
  const subParameters = (sub["parameters"] as unknown[] | undefined) ?? [];
  const supParameters = (sup["parameters"] as unknown[] | undefined) ?? [];
  if (subParameters.length > supParameters.length) return false;
  if (!subParameters.every((parameter, index) => fits(supParameters[index], parameter)))
    return false;
  return fits(sub["returnType"], sup["returnType"]);
}

const fits: {
  (supSchema: unknown): (subSchema: unknown) => boolean;
  (subSchema: unknown, supSchema: unknown): boolean;
} = dual(2, schemaFits);

const schemaModule = {
  assertValid,
  canonicalIdentity,
  canonicalJson,
  deepEqual,
  fits,
  hash64,
  normalize,
};

export default schemaModule;
