const TAG_KEYWORDS = [
  "minimum",
  "exclusiveMinimum",
  "maximum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
];
const LOWER_BOUNDS = new Set(["minimum", "exclusiveMinimum", "minLength", "minItems"]);
const UPPER_BOUNDS = new Set(["maximum", "exclusiveMaximum", "maxLength", "maxItems"]);
const MAX_TAG_CHARS = 80;
export const LINE_TERMINATORS = /[\r\n\u2028\u2029]/gu;

type SchemaObject = Record<string, unknown>;

const isObject = (value: unknown): value is SchemaObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function normalizeExclusive(candidate: SchemaObject): SchemaObject {
  const normalized: SchemaObject = { ...candidate };
  if (candidate["exclusiveMinimum"] === true) {
    normalized["minimum"] = undefined;
    normalized["exclusiveMinimum"] = candidate["minimum"];
  }
  if (candidate["exclusiveMaximum"] === true) {
    normalized["maximum"] = undefined;
    normalized["exclusiveMaximum"] = candidate["maximum"];
  }
  return normalized;
}

function constraintBranches(property: SchemaObject): SchemaObject[] {
  const variants = Array.isArray(property["anyOf"]) ? property["anyOf"] : property["oneOf"];
  const nonNull: unknown[] = Array.isArray(variants)
    ? variants.filter((variant) => (variant as { type?: unknown } | null)?.type !== "null")
    : [];
  const branch = nonNull.length === 1 ? nonNull[0] : undefined;
  const branches = isObject(branch) ? [property, branch] : [property];
  return branches.map(normalizeExclusive);
}

const isInteger = (type: unknown) =>
  type === "integer" || (Array.isArray(type) && type.includes("integer"));

function keywordTags(schemas: SchemaObject[]): string[] {
  const tags: string[] = [];
  for (const keyword of TAG_KEYWORDS) {
    const values = schemas.map((normalized) => normalized[keyword]);
    if (LOWER_BOUNDS.has(keyword) || UPPER_BOUNDS.has(keyword)) {
      const numbers = values.filter((value) => typeof value === "number");
      if (numbers.length === 0) continue;
      tags.push(
        `@${keyword} ${LOWER_BOUNDS.has(keyword) ? Math.max(...numbers) : Math.min(...numbers)}`,
      );
      continue;
    }
    for (const value of new Set(values)) {
      if (typeof value === "number" || typeof value === "string") tags.push(`@${keyword} ${value}`);
    }
  }
  return tags;
}

const escapeTerminators = (tag: string): string =>
  tag.replace(LINE_TERMINATORS, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function constraintTags(schema: unknown): string {
  if (!isObject(schema)) return "";
  const schemas = constraintBranches(schema);
  const tags: string[] = [];
  if (schemas.some((normalized) => isInteger(normalized["type"]))) tags.push("@integer");
  tags.push(...keywordTags(schemas));
  if (schemas.some((normalized) => normalized["uniqueItems"] === true)) tags.push("@uniqueItems");
  if (schema["default"] !== undefined && schema["default"] !== null) {
    tags.push(`@default ${JSON.stringify(schema["default"])}`);
  }
  if (schema["deprecated"] === true) tags.push("@deprecated");
  return tags
    .filter((tag) => tag.length <= MAX_TAG_CHARS)
    .map(escapeTerminators)
    .join(" ");
}
