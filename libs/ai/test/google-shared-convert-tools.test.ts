import { describe, expect, it } from "vite-plus/test";

import googleTools from "../src/api/google-tools.ts";
import type typesModule from "../src/types.types.ts";

const { convertTools, resolveGoogleFunctionCallingMode, supportsGoogleStrictToolSampling } =
  googleTools;

function makeTool(parameters: Record<string, unknown>): typesModule.Tool {
  return {
    description: "A test tool",
    name: "test_tool",
    parameters: parameters as typesModule.Tool["parameters"],
  };
}

describe("google-shared convertTools", () => {
  it("strips JSON Schema meta keys from parameters when useParameters=true", () => {
    const tools = [
      makeTool({
        $comment: "A bash tool for demonstration",
        $defs: {
          commandDef: { type: "string" },
        },
        $id: "urn:bash-tool",
        $schema: "http://json-schema.org/draft-07/schema#",
        definitions: {
          legacyDef: { type: "number" },
        },
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
        type: "object",
      }),
    ];

    const result = convertTools(tools, true);
    const decl = result?.[0]?.functionDeclarations?.[0];

    expect(decl).toBeDefined();
    expect(decl?.["parameters"]).toEqual({
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      type: "object",
    });
    expect(decl?.["parameters"]).not.toHaveProperty("$schema");
    expect(decl?.["parameters"]).not.toHaveProperty("$id");
    expect(decl?.["parameters"]).not.toHaveProperty("$comment");
    expect(decl?.["parameters"]).not.toHaveProperty("$defs");
    expect(decl?.["parameters"]).not.toHaveProperty("definitions");
  });
});

describe("google-shared convertTools", () => {
  it("recursively strips nested JSON Schema meta keys", () => {
    const tools = [
      makeTool({
        $schema: "http://json-schema.org/draft-07/schema#",
        properties: {
          deep: {
            $id: "urn:nested",
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "string",
          },
        },
        type: "object",
      }),
    ];

    const result = convertTools(tools, true);
    const decl = result?.[0]?.functionDeclarations?.[0];

    expect(decl).toBeDefined();
    expect(decl?.["parameters"]).toEqual({
      properties: {
        deep: {
          type: "string",
        },
      },
      type: "object",
    });
  });
});

describe("google-shared convertTools", () => {
  it("preserves $ref while stripping meta keys", () => {
    const tools = [
      makeTool({
        $schema: "http://json-schema.org/draft-07/schema#",
        properties: {
          refProp: {
            $ref: "#/$defs/someDef",
            type: "string",
          },
        },
        type: "object",
      }),
    ];

    const result = convertTools(tools, true);
    const decl = result?.[0]?.functionDeclarations?.[0];

    expect(decl).toBeDefined();
    expect(decl?.["parameters"]).toEqual({
      properties: {
        refProp: {
          $ref: "#/$defs/someDef",
          type: "string",
        },
      },
      type: "object",
    });
  });
});

describe("google-shared convertTools", () => {
  it("does not mutate the original Tool.parameters object", () => {
    const originalParameters = {
      $schema: "http://json-schema.org/draft-07/schema#",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      type: "object",
    };
    const tools = [makeTool(originalParameters)];

    convertTools(tools, true);

    expect(originalParameters).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      type: "object",
    });
  });

  it("preserves $schema in parametersJsonSchema when useParameters=false", () => {
    const tools = [
      makeTool({
        $schema: "http://json-schema.org/draft-07/schema#",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
        type: "object",
      }),
    ];

    const result = convertTools(tools, false);
    const decl = result?.[0]?.functionDeclarations?.[0];

    expect(decl).toBeDefined();
    expect(decl?.["parametersJsonSchema"]).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      type: "object",
    });
  });
});

describe("google-shared convertTools", () => {
  it("handles tools without $schema gracefully", () => {
    const tools = [
      makeTool({
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
        type: "object",
      }),
    ];

    const result = convertTools(tools, true);
    const decl = result?.[0]?.functionDeclarations?.[0];

    expect(decl).toBeDefined();
    expect(decl?.["parameters"]).toEqual({
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      type: "object",
    });
  });

  it("uses validated function calling for strict tools on Gemini 3", () => {
    const tool = makeTool({ properties: {}, type: "object" });
    tool.constrainedSampling = { strict: "require", type: "json_schema" };

    expect(supportsGoogleStrictToolSampling("gemini-3.1-pro-preview")).toBe(true);
    expect(supportsGoogleStrictToolSampling("gemini-2.5-pro")).toBe(false);
    expect(resolveGoogleFunctionCallingMode([tool], undefined, true)).toBe("VALIDATED");
    expect(() => resolveGoogleFunctionCallingMode([tool], undefined, false)).toThrow(
      'Tool "test_tool" requires JSON-schema constrained sampling',
    );
  });

  it("returns undefined for empty tool list", () => {
    expect(convertTools([])).toBeUndefined();
    expect(convertTools([], true)).toBeUndefined();
  });
});
