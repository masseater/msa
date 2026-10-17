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
      type: "object",
      properties: { city: { type: "string" }, "max-lines": { type: "number" } },
      required: ["city"],
      additionalProperties: false,
    }),
  ).toBe('{ city: string; "max-lines"?: number; }');
  expect(schemaToType({ type: "object", additionalProperties: { type: "number" } })).toBe(
    "{ [key: string]: number; }",
  );
  expect(schemaToType({ type: "object" })).toBe("{ [key: string]: unknown; }");
  expect(schemaToType({ type: "object", properties: {}, additionalProperties: false })).toBe("{}");
}

function putsPropertyDescriptionsOnCommentLines(): void {
  expect(
    schemaToType({
      type: "object",
      properties: {
        weather: {
          type: "array",
          description: "look up weather for a given list of locations",
          items: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
      },
      required: ["weather"],
    }),
  ).toBe(
    "{\n  // look up weather for a given list of locations\n  weather: Array<{ location: string; }>;\n}",
  );
  expect(
    schemaToType({
      type: "object",
      properties: {
        outer: {
          type: "object",
          description: "Outer",
          properties: { inner: { type: "string", description: "Inner" } },
        },
      },
    }),
  ).toBe("{\n  // Outer\n  outer?: {\n    // Inner\n    inner?: string;\n  };\n}");
}

function putsConstraintsTheTypeCannotExpress(): void {
  expect(
    schemaToType({
      type: "object",
      properties: {
        timeoutMs: {
          type: "integer",
          minimum: 0,
          maximum: 30000,
          default: 0,
          description: "Wait in milliseconds.",
        },
        id: { type: "string", pattern: "^[a-z]+$", maxLength: 8 },
        tags: {
          type: "array",
          items: { type: "string" },
          maxItems: 5,
          uniqueItems: true,
          deprecated: true,
        },
        name: { type: "string" },
      },
      required: ["id"],
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
      type: "object",
      properties: {
        limit: {
          anyOf: [{ type: "integer", minimum: 1, maximum: 100 }, { type: "null" }],
          default: null,
          title: "Limit",
        },
      },
    }),
  ).toBe("{\n  // @integer @minimum 1 @maximum 100\n  limit?: number | null;\n}");
  expect(
    schemaToType({
      type: "object",
      properties: {
        n: {
          anyOf: [{ type: "integer", minimum: 10, maximum: 50, format: "int32" }, { type: "null" }],
          minimum: 0,
          maximum: 20,
          format: "port",
        },
      },
    }),
  ).toBe(
    "{\n  // @integer @minimum 10 @maximum 20 @format port @format int32\n  n?: number | null;\n}",
  );
}

function readsDraft04BooleanExclusiveBounds(): void {
  expect(
    schemaToType({
      type: "object",
      properties: {
        n: {
          type: "integer",
          minimum: 0,
          exclusiveMinimum: true,
          maximum: 10,
          exclusiveMaximum: false,
        },
        m: {
          anyOf: [{ type: "number", maximum: 5, exclusiveMaximum: true }, { type: "null" }],
          maximum: 8,
        },
      },
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
      type: "object",
      properties: { config: { type: "object", default: { text: "x".repeat(100) } } },
    }),
  ).toBe("{ config?: { [key: string]: unknown; }; }");
  expect(
    schemaToType({
      type: "object",
      properties: {
        sep: {
          type: "string",
          pattern: "^[\r\n\u2028\u2029]$",
          default: "\u2028",
          description: "a\u2028b",
        },
      },
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
  const schema = { type: "object", properties: { n: { type: "integer", minimum: 1 } } };
  expect(schemaToType(schema)).toBe("{\n  // @integer @minimum 1\n  n?: number;\n}");
  expect(schemaToTypeWithin(schema, 20)).toBe("{ n?: number; }");
  expect(schemaToTypeWithin(schema, 10)).toBe("unknown");
}

function resolvesLocalReferencesAndStopsAt(): void {
  const schema = {
    type: "object",
    properties: {
      item: { $ref: "#/$defs/Item" },
      legacy: { $ref: "#/definitions/Legacy" },
      remote: { $ref: "https://example.com/schema.json" },
    },
    required: ["item"],
    $defs: {
      Item: {
        type: "object",
        properties: { id: { type: "string" }, parent: { $ref: "#/$defs/Item" } },
        required: ["id"],
      },
    },
    definitions: { Legacy: { enum: ["a", "b"] } },
  };
  expect(schemaToType(schema)).toBe(
    '{ item: { id: string; parent?: unknown; }; legacy?: "a" | "b"; remote?: unknown; }',
  );
}

function rendersArraysAndTuples(): void {
  expect(schemaToType({ type: "array", items: { type: "string" } })).toBe("Array<string>");
  expect(
    schemaToType({ type: "array", prefixItems: [{ type: "string" }, { type: "number" }] }),
  ).toBe("[string, number]");
  expect(schemaToType({ type: "array" })).toBe("unknown[]");
}

function rendersTypesOverTheBudgetAs(): void {
  const properties = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [`field${i}`, { type: "string" }]),
  );
  const schema = { type: "object", properties };
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
