import { dual } from "effect/Function";

import { constraintTags, LINE_TERMINATORS } from "./schema-tags.ts";
import type { CodemodeJsonSchema } from "./types.ts";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const INDENT = "  ";
const MAX_REF_EXPANSIONS = 32;

interface SchemaContext {
  root: CodemodeJsonSchema;
  resolving: Set<string>;
  expansions: number;
  tags: boolean;
}

type SchemaObject = Record<string, unknown>;

const isObject = (value: unknown): value is SchemaObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function union(types: string[]): string {
  const unique = [...new Set(types)];
  if (unique.includes("unknown")) return "unknown";
  return unique.length === 0 ? "never" : unique.join(" | ");
}

function resolveRef(ref: string, root: CodemodeJsonSchema): CodemodeJsonSchema | undefined {
  if (ref !== "#" && !ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const segment of ref.slice(2).split("/").filter(Boolean)) {
    const key = decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current) || !(key in current)) return undefined;
    current = current[key];
  }
  if (typeof current === "boolean") return current;
  return isObject(current) ? current : undefined;
}

function refType(ref: string, context: SchemaContext): string {
  if (context.resolving.has(ref) || context.expansions >= MAX_REF_EXPANSIONS) return "unknown";
  const target = resolveRef(ref, context.root);
  if (target === undefined) return "unknown";
  context.expansions++;
  context.resolving.add(ref);
  try {
    return toType(target, context);
  } finally {
    context.resolving.delete(ref);
  }
}

function compositeType(schema: SchemaObject, context: SchemaContext): string | undefined {
  if ("const" in schema) return JSON.stringify(schema["const"]) ?? "unknown";
  if (Array.isArray(schema["enum"]))
    return union(schema["enum"].map((value) => JSON.stringify(value) ?? "unknown"));
  const variants = Array.isArray(schema["anyOf"])
    ? schema["anyOf"]
    : Array.isArray(schema["oneOf"])
      ? schema["oneOf"]
      : undefined;
  if (variants !== undefined)
    return union(variants.map((variant) => toType(variant as CodemodeJsonSchema, context)));
  if (!Array.isArray(schema["allOf"])) return undefined;
  const parts = schema["allOf"]
    .map((part) => toType(part as CodemodeJsonSchema, context))
    .filter((part) => part !== "unknown");
  return parts.length === 0
    ? "unknown"
    : parts.map((part) => (part.includes(" | ") ? `(${part})` : part)).join(" & ");
}

function untypedType(schema: SchemaObject, context: SchemaContext): string {
  if ("properties" in schema || "additionalProperties" in schema || "required" in schema) {
    return objectType(schema, context);
  }
  if ("items" in schema || "prefixItems" in schema) return arrayType(schema, context);
  return "unknown";
}

function keywordType(schema: SchemaObject, context: SchemaContext): string {
  const type = schema["type"];
  if (Array.isArray(type))
    return union(type.map((entry) => toType({ ...schema, type: entry }, context)));
  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return arrayType(schema, context);
    case "object":
      return objectType(schema, context);
    case undefined:
      return untypedType(schema, context);
    default:
      return "unknown";
  }
}

function toType(schema: CodemodeJsonSchema, context: SchemaContext): string {
  if (schema === true) return "unknown";
  if (schema === false) return "never";
  if (!isObject(schema)) return "unknown";
  if (typeof schema["$ref"] === "string") return refType(schema["$ref"], context);
  return compositeType(schema, context) ?? keywordType(schema, context);
}

function arrayType(schema: SchemaObject, context: SchemaContext): string {
  if (schema["items"] !== undefined && !Array.isArray(schema["items"])) {
    return `Array<${toType(schema["items"] as CodemodeJsonSchema, context)}>`;
  }
  const tuple = Array.isArray(schema["prefixItems"])
    ? schema["prefixItems"]
    : Array.isArray(schema["items"])
      ? schema["items"]
      : [];
  if (tuple.length > 0)
    return `[${tuple.map((item) => toType(item as CodemodeJsonSchema, context)).join(", ")}]`;
  return "unknown[]";
}

function descriptionOf(property: unknown): string {
  const description = (property as { description?: unknown } | null | undefined)?.description;
  return typeof description === "string" ? description.trim() : "";
}

function objectMembers(schema: SchemaObject, names: string[], context: SchemaContext): string[] {
  const properties = isObject(schema["properties"]) ? schema["properties"] : {};
  const required = new Set(Array.isArray(schema["required"]) ? schema["required"] : []);
  const members = names.map((name) => {
    const optional = required.has(name) ? "" : "?";
    return `${propertyKey(name)}${optional}: ${toType(properties[name] as CodemodeJsonSchema, context)};`;
  });
  const additional = schema["additionalProperties"];
  if (additional !== undefined && additional !== false) {
    const type =
      additional === true ? "unknown" : toType(additional as CodemodeJsonSchema, context);
    members.push(`[key: string]: ${type};`);
  } else if (additional === undefined && names.length === 0) {
    members.push("[key: string]: unknown;");
  }
  return members;
}

function propertyComments(properties: SchemaObject, names: string[], tagged: boolean): string[][] {
  return names.map((name) => {
    const lines = descriptionOf(properties[name])
      .split(LINE_TERMINATORS)
      .map((line) => line.trim())
      .filter(Boolean);
    const tags = tagged ? constraintTags(properties[name]) : "";
    return tags === "" ? lines : [...lines, tags];
  });
}

function objectType(schema: SchemaObject, context: SchemaContext): string {
  const properties = isObject(schema["properties"]) ? schema["properties"] : {};
  const names = Object.keys(properties).sort();
  const members = objectMembers(schema, names, context);
  if (members.length === 0) return "{}";
  const comments = propertyComments(properties, names, context.tags);
  if (!comments.some((comment) => comment.length > 0)) return `{ ${members.join(" ")} }`;
  const lines = ["{"];
  comments.forEach((comment, index) => {
    for (const line of comment) lines.push(`${INDENT}// ${line}`);
    const member = members[index];
    if (member === undefined) throw new Error(`Property ${names[index]} has no member`);
    lines.push(`${INDENT}${member.replaceAll("\n", `\n${INDENT}`)}`);
  });
  for (const member of members.slice(names.length)) lines.push(`${INDENT}${member}`);
  lines.push("}");
  return lines.join("\n");
}

const render = (schema: CodemodeJsonSchema, tags: boolean) =>
  toType(schema, { root: schema, resolving: new Set(), expansions: 0, tags });

export function schemaToType(schema: CodemodeJsonSchema): string {
  return render(schema, true);
}

export const schemaToTypeWithin: {
  (maxChars: number): (schema: CodemodeJsonSchema) => string;
  (schema: CodemodeJsonSchema, maxChars: number): string;
} = dual(2, (schema: CodemodeJsonSchema, maxChars: number): string => {
  const type = render(schema, true);
  if (type.length <= maxChars) return type;
  const untagged = render(schema, false);
  return untagged.length <= maxChars ? untagged : "unknown";
});
