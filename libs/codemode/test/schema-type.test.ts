import { describe, expect, it } from "vite-plus/test";

import { schemaToType, schemaToTypeWithin } from "../src/index.ts";

function rendersPrimitivesLiteralsAndUnions(): void {
  expect(schemaToType({ type: "string" })).toBe("string");
  expect(schemaToType({ type: "integer" })).toBe("number");
  expect(schemaToType({ type: ["string", "null"] })).toBe("string | null");
  expect(schemaToType({ const: "a" })).toBe('"a"');
  expect(schemaToType({ enum: ["a", 1, null] })).toBe('"a" | 1 | null');
  expect(schemaToType({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
  expect(schemaToType({ anyOf: [{ type: "string" }, {}] })).toBe("unknown");
  expect(
    schemaToType({ allOf: [{ anyOf: [{ type: "string" }, { type: "number" }] }, { const: 1 }] }),
  ).toBe("(string | number) & 1");
  expect(schemaToType({ $ref: "#/defs/x" })).toBe("unknown");
  expect(schemaToType(true)).toBe("unknown");
  expect(schemaToType(false)).toBe("never");
}

function rendersObjectsOnOneLineWith(): void {
  expect(
    schemaToType({
      additionalProperties: false,
      properties: { city: { type: "string" }, "max-lines": { type: "number" } },
      required: ["city"],
      type: "object",
    }),
  ).toBe('{ city: string; "max-lines"?: number; }');
  expect(schemaToType({ additionalProperties: { type: "number" }, type: "object" })).toBe(
    "{ [key: string]: number; }",
  );
  expect(schemaToType({ type: "object" })).toBe("{ [key: string]: unknown; }");
  expect(schemaToType({ additionalProperties: false, properties: {}, type: "object" })).toBe("{}");
}

function putsPropertyDescriptionsOnCommentLines(): void {
  expect(
    schemaToType({
      properties: {
        weather: {
          description: "look up weather for a given list of locations",
          items: {
            properties: { location: { type: "string" } },
            required: ["location"],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["weather"],
      type: "object",
    }),
  ).toBe(
    "{\n  // look up weather for a given list of locations\n  weather: Array<{ location: string; }>;\n}",
  );
  expect(
    schemaToType({
      properties: {
        outer: {
          description: "Outer",
          properties: { inner: { description: "Inner", type: "string" } },
          type: "object",
        },
      },
      type: "object",
    }),
  ).toBe("{\n  // Outer\n  outer?: {\n    // Inner\n    inner?: string;\n  };\n}");
}

function putsConstraintsTheTypeCannotExpress(): void {
  expect(
    schemaToType({
      properties: {
        id: { maxLength: 8, pattern: "^[a-z]+$", type: "string" },
        name: { type: "string" },
        tags: {
          deprecated: true,
          items: { type: "string" },
          maxItems: 5,
          type: "array",
          uniqueItems: true,
        },
        timeoutMs: {
          default: 0,
          description: "Wait in milliseconds.",
          maximum: 30000,
          minimum: 0,
          type: "integer",
        },
      },
      required: ["id"],
      type: "object",
    }),
  ).toBe(
    [
      "{",
      "  // @maxLength 8 @pattern ^[a-z]+$",
      "  id: string;",
      "  name?: string;",
      "  // @maxItems 5 @uniqueItems @deprecated",
      "  tags?: Array<string>;",
      "  // Wait in milliseconds.",
      "  // @integer @minimum 0 @maximum 30000 @default 0",
      "  timeoutMs?: number;",
      "}",
    ].join("\n"),
  );
}

function readsConstraintsOfOptionalFieldsFrom(): void {
  expect(
    schemaToType({
      properties: {
        limit: {
          anyOf: [{ maximum: 100, minimum: 1, type: "integer" }, { type: "null" }],
          default: null,
          title: "Limit",
        },
      },
      type: "object",
    }),
  ).toBe("{\n  // @integer @minimum 1 @maximum 100\n  limit?: number | null;\n}");
  expect(
    schemaToType({
      properties: {
        n: {
          anyOf: [{ format: "int32", maximum: 50, minimum: 10, type: "integer" }, { type: "null" }],
          format: "port",
          maximum: 20,
          minimum: 0,
        },
      },
      type: "object",
    }),
  ).toBe(
    "{\n  // @integer @minimum 10 @maximum 20 @format port @format int32\n  n?: number | null;\n}",
  );
}

function readsDraft04BooleanExclusiveBounds(): void {
  expect(
    schemaToType({
      properties: {
        m: {
          anyOf: [{ exclusiveMaximum: true, maximum: 5, type: "number" }, { type: "null" }],
          maximum: 8,
        },
        n: {
          exclusiveMaximum: false,
          exclusiveMinimum: true,
          maximum: 10,
          minimum: 0,
          type: "integer",
        },
      },
      type: "object",
    }),
  ).toBe(
    [
      "{",
      "  // @maximum 8 @exclusiveMaximum 5",
      "  m?: number | null;",
      "  // @integer @exclusiveMinimum 0 @maximum 10",
      "  n?: number;",
      "}",
    ].join("\n"),
  );
}

function leavesOutLongTagsAndEscapes(): void {
  expect(
    schemaToType({
      properties: { config: { default: { text: "x".repeat(100) }, type: "object" } },
      type: "object",
    }),
  ).toBe("{ config?: { [key: string]: unknown; }; }");
  expect(
    schemaToType({
      properties: {
        sep: {
          default: "\u2028",
          description: "a\u2028b",
          pattern: "^[\r\n\u2028\u2029]$",
          type: "string",
        },
      },
      type: "object",
    }),
  ).toBe(
    [
      "{",
      "  // a",
      "  // b",
      '  // @pattern ^[\\u000d\\u000a\\u2028\\u2029]$ @default "\\u2028"',
      "  sep?: string;",
      "}",
    ].join("\n"),
  );
}

function dropsConstraintTagsBeforeRenderingA(): void {
  const schema = { properties: { n: { minimum: 1, type: "integer" } }, type: "object" };
  expect(schemaToType(schema)).toBe("{\n  // @integer @minimum 1\n  n?: number;\n}");
  expect(schemaToTypeWithin(schema, 20)).toBe("{ n?: number; }");
  expect(schemaToTypeWithin(schema, 10)).toBe("unknown");
}

function resolvesLocalReferencesAndStopsAt(): void {
  const schema = {
    $defs: {
      Item: {
        properties: { id: { type: "string" }, parent: { $ref: "#/$defs/Item" } },
        required: ["id"],
        type: "object",
      },
    },
    definitions: { Legacy: { enum: ["a", "b"] } },
    properties: {
      item: { $ref: "#/$defs/Item" },
      legacy: { $ref: "#/definitions/Legacy" },
      remote: { $ref: "https://example.com/schema.json" },
    },
    required: ["item"],
    type: "object",
  };
  expect(schemaToType(schema)).toBe(
    '{ item: { id: string; parent?: unknown; }; legacy?: "a" | "b"; remote?: unknown; }',
  );
}

function rendersArraysAndTuples(): void {
  expect(schemaToType({ items: { type: "string" }, type: "array" })).toBe("Array<string>");
  expect(
    schemaToType({ prefixItems: [{ type: "string" }, { type: "number" }], type: "array" }),
  ).toBe("[string, number]");
  expect(schemaToType({ type: "array" })).toBe("unknown[]");
}

function rendersTypesOverTheBudgetAs(): void {
  const properties = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [`field${i}`, { type: "string" }]),
  );
  const schema = { properties, type: "object" };
  expect(schemaToTypeWithin(schema, 100)).toBe("unknown");
  expect(schemaToType(schema)).toContain("field49?: string;");
}

describe("schemaToType", () => {
  it("renders primitives, literals, and unions", rendersPrimitivesLiteralsAndUnions);

  it("renders objects on one line with sorted properties", rendersObjectsOnOneLineWith);

  it("puts property descriptions on comment lines", putsPropertyDescriptionsOnCommentLines);

  it(
    "puts constraints the type cannot express on property comment lines",
    putsConstraintsTheTypeCannotExpress,
  );

  it(
    "reads constraints of optional fields from the non-null branch",
    readsConstraintsOfOptionalFieldsFrom,
  );

  it("reads draft-04 boolean exclusive bounds", readsDraft04BooleanExclusiveBounds);

  it("leaves out long tags and escapes line terminators", leavesOutLongTagsAndEscapes);

  it(
    "drops constraint tags before rendering a type over the budget as unknown",
    dropsConstraintTagsBeforeRenderingA,
  );

  it("resolves local references and stops at recursive ones", resolvesLocalReferencesAndStopsAt);

  it("renders arrays and tuples", rendersArraysAndTuples);

  it("renders types over the budget as unknown", rendersTypesOverTheBudgetAs);
});
