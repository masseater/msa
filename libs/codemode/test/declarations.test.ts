import { describe, expect, it } from "vite-plus/test";

import { renderDeclarations, renderToolSample, renderToolSignature } from "../src/index.ts";

const execute = () => undefined;

function rendersSignaturesWithNormalizedIdentifiers(): void {
  expect(
    renderToolSignature({
      name: "hidden-dynamic-tool",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
        additionalProperties: false,
      },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    }),
  ).toBe("hidden_dynamic_tool(args: { city: string; }): Promise<{ ok: boolean; }>;");
  expect(renderToolSignature({ name: "free" })).toBe("free(args: unknown): Promise<unknown>;");
}

function rendersOutputSchemasShapedLikeAn(): void {
  const outputSchema = {
    type: "object",
    properties: {
      content: { type: "array", items: { type: "object" } },
      isError: { type: "boolean" },
      _meta: { type: "object" },
    },
    required: ["content"],
  };
  expect(
    renderToolSignature({
      name: "plain",
      inputSchema: { type: "object", properties: {} },
      outputSchema,
    }),
  ).toBe(
    "plain(args: { [key: string]: unknown; }): Promise<{ _meta?: { [key: string]: unknown; }; content: Array<{ [key: string]: unknown; }>; isError?: boolean; }>;",
  );
}

function rendersThePerToolSample(): void {
  expect(
    renderToolSample({ name: "foo", description: "bar", inputSchema: { type: "string" } }),
  ).toBe(
    "bar\n\ncodemode tool declaration:\n```ts\ndeclare const tools: { foo(args: string): Promise<unknown>; };\n```",
  );
}

function rendersToolsAndGlobals(): void {
  const text = renderDeclarations({
    tools: [
      {
        name: "read",
        description: "Read a file.\nSecond line.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        outputSchema: { type: "string" },
        execute,
      },
      { name: "remote-api", execute },
    ],
    globals: [
      { name: "attach", description: "Attach it.", inputSchema: { type: "string" }, execute },
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
        name: "models.list",
        description: "List models.",
        signature: "(type: string): Promise<string[]>",
        execute,
      },
      { name: "models.get", inputSchema: { type: "string" }, execute },
      { name: "plain", signature: "(): void", execute },
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
  const text = renderDeclarations({ tools: [{ name: "x", description: "a */ b", execute }] });
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
