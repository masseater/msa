import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import constrainedSamplingModule from "../src/api/constrained-sampling.ts";
import openaiResponsesTools from "../src/api/openai-responses-tools.ts";
import type typesModule from "../src/types.types.ts";

const { convertResponsesTools } = openaiResponsesTools;
const { makeStrictJsonSchema, resolveJsonSchemaStrictSampling } = constrainedSamplingModule;

function makeTool(overrides: Partial<typesModule.Tool> = {}): typesModule.Tool {
  return {
    description: "Sample tool",
    name: "sample_tool",
    parameters: Type.Object({ payload: Type.String() }, { additionalProperties: false }),
    ...overrides,
  };
}

const convertsSupportedConstraintsAndFallsBack = () => {
  expect(
    convertResponsesTools([
      makeTool({ constrainedSampling: { strict: "prefer", type: "json_schema" } }),
    ])[0],
  ).toMatchObject({ name: "sample_tool", strict: true, type: "function" });

  expect(() =>
    convertResponsesTools(
      [makeTool({ constrainedSampling: { strict: "require", type: "json_schema" } })],
      {
        supportsStrictMode: false,
      },
    ),
  ).toThrow('Tool "sample_tool" requires JSON-schema constrained sampling');

  const grammarTool = makeTool({
    constrainedSampling: { type: "grammar", variants: { openai_lark: "start: /[a-z]+/" } },
  });
  expect(
    convertResponsesTools([grammarTool], { supportsOpenAIGrammarTools: true })[0],
  ).toMatchObject({
    format: { definition: "start: /[a-z]+/", syntax: "lark", type: "grammar" },
    name: "sample_tool",
    type: "custom",
  });
  expect(() =>
    convertResponsesTools([makeTool({ constrainedSampling: { type: "grammar", variants: {} } })], {
      supportsOpenAIGrammarTools: true,
    }),
  ).toThrow(
    'Tool "sample_tool" cannot use grammar constrained sampling: no supported grammar variant was provided',
  );

  const fallback = convertResponsesTools([grammarTool], {
    supportsOpenAIGrammarTools: false,
    supportsStrictMode: false,
  })[0];
  expect(fallback).toMatchObject({ name: "sample_tool", type: "function" });
  expect("strict" in (fallback as object)).toBe(false);

  expect(convertResponsesTools([makeTool({ constrainedSampling: false })])).toEqual(
    convertResponsesTools([makeTool()]),
  );
};

const derivesStrictProviderSchemasWithoutChanging = () => {
  const parameters = Type.Object({
    metadata: Type.Object({ enabled: Type.Optional(Type.Boolean()) }),
    nullable: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    offset: Type.Optional(Type.Number()),
    path: Type.String(),
  });

  const strict = makeStrictJsonSchema(parameters);

  expect(parameters).not.toHaveProperty("additionalProperties");
  expect(parameters.required).toEqual(["metadata", "path"]);
  expect(strict).toMatchObject({
    additionalProperties: false,
    properties: {
      metadata: {
        additionalProperties: false,
        properties: { enabled: { anyOf: [{ type: "boolean" }, { type: "null" }] } },
        required: ["enabled"],
      },
      nullable: { anyOf: [{ type: "string" }, { type: "null" }] },
      offset: { anyOf: [{ type: "number" }, { type: "null" }] },
    },
    required: ["metadata", "nullable", "offset", "path"],
  });
};

const fallsBackOrRejectsSchemasThat = () => {
  const cases: Array<{ parameters: typesModule.Tool["parameters"]; error: string }> = [
    {
      error: "additionalProperties is unsupported",
      parameters: Type.Object({
        metadata: Type.Object({}, { additionalProperties: Type.String() }),
      }),
    },
    {
      error: "allOf schemas are unsupported",
      parameters: Type.Intersect([
        Type.Object({ a: Type.String() }),
        Type.Object({ b: Type.Number() }),
      ]),
    },
    {
      error: "object and array unions are unsupported",
      parameters: Type.Object({
        value: Type.Union([Type.Object({ nested: Type.String() }), Type.Null()]),
      }),
    },
    {
      error: "$ref schemas are unsupported",
      parameters: {
        properties: { child: { $ref: "https://example.com/child.json" } },
        required: ["child"],
        type: "object",
      } as typesModule.Tool["parameters"],
    },
  ];

  for (const { parameters, error } of cases) {
    const tool: typesModule.Tool = {
      ...makeTool(),
      constrainedSampling: { strict: "prefer", type: "json_schema" },
      parameters,
    };

    expect(() => makeStrictJsonSchema(parameters)).toThrow(error);
    expect(resolveJsonSchemaStrictSampling(tool, true)).toBeUndefined();
    expect(convertResponsesTools([tool], { supportsStrictMode: true })[0]).toMatchObject({
      parameters,
      strict: false,
    });

    tool.constrainedSampling = { strict: "require", type: "json_schema" };
    expect(() => resolveJsonSchemaStrictSampling(tool, true)).toThrow(error);
  }
};

describe("constrained tool sampling", () => {
  it(
    "converts supported constraints and falls back when unsupported",
    convertsSupportedConstraintsAndFallsBack,
  );
});

describe("constrained tool sampling", () => {
  it(
    "derives strict provider schemas without changing tool definitions",
    derivesStrictProviderSchemasWithoutChanging,
  );
});

describe("constrained tool sampling", () => {
  it(
    "falls back or rejects schemas that cannot be safely converted",
    fallsBackOrRejectsSchemasThat,
  );
});
