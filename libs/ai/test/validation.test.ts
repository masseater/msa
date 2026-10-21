import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { describe, expect, it } from "vite-plus/test";

import type typesModule from "../src/types.types.ts";
import validation from "../src/utils/validation.ts";

const { validateToolArguments } = validation;

function createToolCallWithPlainSchema(
  schema: typesModule.Tool["parameters"],
  value: unknown,
): {
  tool: typesModule.Tool;
  toolCall: typesModule.ToolCall;
} {
  const tool: typesModule.Tool = {
    description: "Echo tool",
    name: "echo",
    parameters: {
      properties: {
        value: schema,
      },
      required: ["value"],
      type: "object",
    } as typesModule.Tool["parameters"],
  };

  const toolCall: typesModule.ToolCall = {
    arguments: { value: value as typesModule.JsonValue },
    id: "tool-1",
    name: "echo",
    type: "toolCall",
  };

  return { tool, toolCall };
}

describe("validateToolArguments", () => {
  it("still validates when Function constructor is unavailable", () => {
    const originalFunction = globalThis.Function;
    const tool: typesModule.Tool = {
      description: "Echo tool",
      name: "echo",
      parameters: Type.Object({
        count: Type.Number(),
      }),
    };
    const toolCall: typesModule.ToolCall = {
      arguments: { count: "42" as unknown as number },
      id: "tool-1",
      name: "echo",
      type: "toolCall",
    };

    globalThis.Function = (() => {
      throw new EvalError("Code generation from strings disallowed for this context");
    }) as unknown as FunctionConstructor;

    try {
      expect(validateToolArguments(tool, toolCall)).toEqual({ count: 42 });
    } finally {
      globalThis.Function = originalFunction;
    }
  });
});

describe("validateToolArguments", () => {
  it("coerces serialized plain JSON schemas with AJV-compatible primitive rules", () => {
    const passingCases: Array<{
      schema: typesModule.Tool["parameters"];
      input: unknown;
      expected: unknown;
    }> = [
      { expected: 42, input: "42", schema: { type: "number" } as typesModule.Tool["parameters"] },
      { expected: 1, input: true, schema: { type: "number" } as typesModule.Tool["parameters"] },
      { expected: 0, input: null, schema: { type: "number" } as typesModule.Tool["parameters"] },
      { expected: 42, input: "42", schema: { type: "integer" } as typesModule.Tool["parameters"] },
      {
        expected: true,
        input: "true",
        schema: { type: "boolean" } as typesModule.Tool["parameters"],
      },
      {
        expected: false,
        input: "false",
        schema: { type: "boolean" } as typesModule.Tool["parameters"],
      },
      { expected: true, input: 1, schema: { type: "boolean" } as typesModule.Tool["parameters"] },
      { expected: false, input: 0, schema: { type: "boolean" } as typesModule.Tool["parameters"] },
      { expected: "", input: null, schema: { type: "string" } as typesModule.Tool["parameters"] },
      {
        expected: "true",
        input: true,
        schema: { type: "string" } as typesModule.Tool["parameters"],
      },
      { expected: null, input: "", schema: { type: "null" } as typesModule.Tool["parameters"] },
      { expected: null, input: 0, schema: { type: "null" } as typesModule.Tool["parameters"] },
      { expected: null, input: false, schema: { type: "null" } as typesModule.Tool["parameters"] },
      {
        expected: "1",
        input: "1",
        schema: { type: ["number", "string"] } as typesModule.Tool["parameters"],
      },
      {
        expected: 1,
        input: "1",
        schema: { type: ["boolean", "number"] } as typesModule.Tool["parameters"],
      },
    ];

    for (const testCase of passingCases) {
      const { tool, toolCall } = createToolCallWithPlainSchema(testCase.schema, testCase.input);
      expect(validateToolArguments(tool, toolCall)).toEqual({ value: testCase.expected });
    }
  });
});

describe("validateToolArguments", () => {
  it("treats null as omission for optional non-nullable properties", () => {
    const tool: typesModule.Tool = {
      description: "Echo tool",
      name: "echo",
      parameters: Type.Object({
        metadata: Type.Object({ enabled: Type.Optional(Type.Boolean()) }),
        nullable: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        offset: Type.Optional(Type.Number()),
        path: Type.String(),
      }),
    };
    const toolCall: typesModule.ToolCall = {
      arguments: { metadata: { enabled: null }, nullable: null, offset: null, path: "file.txt" },
      id: "tool-1",
      name: "echo",
      type: "toolCall",
    };

    expect(validateToolArguments(tool, toolCall)).toEqual({
      metadata: {},
      nullable: null,
      path: "file.txt",
    });
  });

  it("preserves optional nulls whose referenced schema is nullable", () => {
    const tool: typesModule.Tool = {
      description: "Echo tool",
      name: "echo",
      parameters: {
        $defs: { value: { anyOf: [{ type: "number" }, { type: "null" }] } },
        properties: { value: { $ref: "#/$defs/value" } },
        type: "object",
      } as typesModule.Tool["parameters"],
    };
    const toolCall: typesModule.ToolCall = {
      arguments: { value: null },
      id: "tool-1",
      name: "echo",
      type: "toolCall",
    };

    expect(validateToolArguments(tool, toolCall)).toEqual({ value: null });
  });
});

describe("validateToolArguments", () => {
  it("preserves a value that already matches a nullable union arm", () => {
    const tool: typesModule.Tool = {
      description: "Echo tool",
      name: "echo",
      parameters: Type.Object({
        value: Type.Union([Type.Number(), Type.Null()]),
      }),
    };
    const toolCall: typesModule.ToolCall = {
      arguments: { value: null },
      id: "tool-1",
      name: "echo",
      type: "toolCall",
    };

    expect(validateToolArguments(tool, toolCall)).toEqual({ value: null });
  });

  it("preserves a value that already matches a oneOf nullable union arm", () => {
    const { tool, toolCall } = createToolCallWithPlainSchema(
      { oneOf: [{ type: "number" }, { type: "null" }] } as typesModule.Tool["parameters"],
      null,
    );

    expect(validateToolArguments(tool, toolCall)).toEqual({ value: null });
  });

  it("still coerces nullable unions when the original value does not match any arm", () => {
    const { tool, toolCall } = createToolCallWithPlainSchema(
      { anyOf: [{ type: "number" }, { type: "null" }] } as typesModule.Tool["parameters"],
      "42",
    );

    expect(validateToolArguments(tool, toolCall)).toEqual({ value: 42 });
  });

  it("accepts null for nullable array schemas with items", () => {
    const { tool, toolCall } = createToolCallWithPlainSchema(
      { items: { type: "string" }, type: ["array", "null"] } as typesModule.Tool["parameters"],
      null,
    );
    const generatedCheck = new Function(Compile(tool.parameters).Code())() as (
      value: unknown,
    ) => boolean;

    expect(generatedCheck(toolCall.arguments)).toBe(true);
    expect(validateToolArguments(tool, toolCall)).toEqual({ value: null });
  });
});

describe("validateToolArguments", () => {
  it("rejects invalid coercions for serialized plain JSON schemas", () => {
    const failingCases: Array<{
      schema: typesModule.Tool["parameters"];
      input: unknown;
    }> = [
      { input: "1", schema: { type: "boolean" } as typesModule.Tool["parameters"] },
      { input: "0", schema: { type: "boolean" } as typesModule.Tool["parameters"] },
      { input: "null", schema: { type: "null" } as typesModule.Tool["parameters"] },
      { input: "42.1", schema: { type: "integer" } as typesModule.Tool["parameters"] },
    ];

    for (const testCase of failingCases) {
      const { tool, toolCall } = createToolCallWithPlainSchema(testCase.schema, testCase.input);
      expect(() => validateToolArguments(tool, toolCall)).toThrow("Validation failed");
    }
  });

  it("reports malformed arguments JSON instead of validating empty arguments", () => {
    const tool: typesModule.Tool = {
      description: "Echo tool",
      name: "echo",
      parameters: Type.Object({ value: Type.Optional(Type.String()) }),
    };
    const toolCall: typesModule.ToolCall = {
      arguments: {},
      argumentsError: "Unexpected token",
      id: "tool-1",
      name: "echo",
      type: "toolCall",
    };

    expect(() => validateToolArguments(tool, toolCall)).toThrow(
      'Invalid arguments for tool "echo": Unexpected token',
    );
  });
});
