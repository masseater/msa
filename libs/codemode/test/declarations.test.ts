import { describe, expect, it } from "vite-plus/test";

import codemode from "../src/index.ts";

const { renderDeclarations, renderToolSample, renderToolSignature } = codemode;

const execute = () => undefined;

function rendersSignaturesWithNormalizedIdentifiers(): void {
  expect(
    renderToolSignature({
      inputSchema: {
        additionalProperties: false,
        properties: { city: { type: "string" } },
        required: ["city"],
        type: "object",
      },
      name: "hidden-dynamic-tool",
      outputSchema: { properties: { ok: { type: "boolean" } }, required: ["ok"], type: "object" },
    }),
  ).toBe("hidden_dynamic_tool(args: { city: string; }): Promise<{ ok: boolean; }>;");
  expect(renderToolSignature({ name: "free" })).toBe("free(args: unknown): Promise<unknown>;");
}

function rendersOutputSchemasShapedLikeAn(): void {
  const outputSchema = {
    properties: {
      _meta: { type: "object" },
      content: { items: { type: "object" }, type: "array" },
      isError: { type: "boolean" },
    },
    required: ["content"],
    type: "object",
  };
  expect(
    renderToolSignature({
      inputSchema: { properties: {}, type: "object" },
      name: "plain",
      outputSchema,
    }),
  ).toBe(
    "plain(args: { [key: string]: unknown; }): Promise<{ _meta?: { [key: string]: unknown; }; content: Array<{ [key: string]: unknown; }>; isError?: boolean; }>;",
  );
}

function rendersThePerToolSample(): void {
  expect(
    renderToolSample({ description: "bar", inputSchema: { type: "string" }, name: "foo" }),
  ).toBe(
    "bar\n\ncodemode tool declaration:\n```ts\ndeclare const tools: { foo(args: string): Promise<unknown>; };\n```",
  );
}

function rendersToolsAndGlobals(): void {
  const text = renderDeclarations({
    globals: [
      { description: "Attach it.", execute, inputSchema: { type: "string" }, name: "attach" },
    ],
    tools: [
      {
        description: "Read a file.\nSecond line.",
        execute,
        inputSchema: {
          properties: { path: { type: "string" } },
          required: ["path"],
          type: "object",
        },
        name: "read",
        outputSchema: { type: "string" },
      },
      { execute, name: "remote-api" },
    ],
  });
  expect(text).toBe(
    [
      "declare const tools: {",
      "  /**",
      "   * Read a file.",
      "   * Second line.",
      "   */",
      "  read(args: { path: string; }): Promise<string>;",
      "  remote_api(args: unknown): Promise<unknown>;",
      "};",
      "",
      "/** Attach it. */",
      "declare function attach(args: string): Promise<unknown>;",
    ].join("\n"),
  );
}

function rendersNamespacedGlobalsAndExplicitSignatures(): void {
  const text = renderDeclarations({
    globals: [
      {
        description: "List models.",
        execute,
        name: "models.list",
        signature: "(type: string): Promise<string[]>",
      },
      { execute, inputSchema: { type: "string" }, name: "models.get" },
      { execute, name: "plain", signature: "(): void" },
    ],
  });
  expect(text).toBe(
    [
      "declare function plain(): void;",
      "",
      "declare const models: {",
      "  /** List models. */",
      "  list(type: string): Promise<string[]>;",
      "  get(args: string): Promise<unknown>;",
      "};",
    ].join("\n"),
  );
}

function escapesCommentTerminatorsInDescriptions(): void {
  const text = renderDeclarations({ tools: [{ description: "a */ b", execute, name: "x" }] });
  expect(text).toContain("/** a *\\/ b */");
}

describe("tool declarations", () => {
  it("renders signatures with normalized identifiers", rendersSignaturesWithNormalizedIdentifiers);

  it(
    "renders output schemas shaped like an MCP CallToolResult as plain types",
    rendersOutputSchemasShapedLikeAn,
  );

  it("renders the per-tool sample", rendersThePerToolSample);
});

describe("renderDeclarations", () => {
  it("renders tools and globals", rendersToolsAndGlobals);

  it(
    "renders namespaced globals and explicit signatures",
    rendersNamespacedGlobalsAndExplicitSignatures,
  );

  it("escapes comment terminators in descriptions", escapesCommentTerminatorsInDescriptions);
});
