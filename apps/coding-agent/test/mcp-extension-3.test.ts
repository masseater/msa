import declarations from "@msa/codemode/declarations";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { truncateMiddle } from "../src/core/tools/truncate.ts";
import {
  convertMcpResult,
  createMcpResultSchema,
  createMcpToolName,
} from "../src/extensions/mcp/tools.ts";

const { renderToolOutputType } = declarations;

const { awaited, runTest } = testing;

const createsProviderSafeToolNames = () => {
  expect(createMcpToolName("docs", "search")).toBe("mcp__docs__search");
  expect(createMcpToolName("my-server", "get.item/v2")).toBe("mcp__my_server__get_item_v2");
  const long = createMcpToolName("server", "x".repeat(100));
  expect(long).toHaveLength(64);
  expect(long).toMatch(/^mcp__server__x+_[0-9a-f]{8}$/u);
  expect(createMcpToolName("server", `${"x".repeat(100)}y`)).not.toBe(long);

  const taken = createMcpToolName("s", "a_b");
  const second = createMcpToolName("s", "a-b", (name) => name === taken);
  expect(second).toMatch(/^mcp__s__a_b_[0-9a-f]{8}$/u);
};

const declaresTheCalltoolresultScriptsReceiveKeepingReferences = () => {
  const content =
    'content: Array<{ data?: string; mimeType?: string; text?: string; type: "text" | "image" | "audio" | "resource_link" | "resource"; [key: string]: unknown; }>; isError?: boolean;';

  expect(renderToolOutputType(createMcpResultSchema(undefined) as never)).toBe(
    `{ ${content} structuredContent?: unknown; [key: string]: unknown; }`,
  );

  const hit = { properties: { id: { type: "string" } }, required: ["id"], type: "object" };
  const schema = createMcpResultSchema({
    $defs: { "Hit/v1": { ...hit, default: { $ref: "#/stays" } } },
    definitions: { Hit: hit },
    properties: {
      again: { $ref: "#/properties/hits" },
      children: { items: { $ref: "#" }, type: "array" },
      default: { $ref: "#/definitions/Hit" },
      hits: { items: { $ref: "#/$defs/Hit~1v1" }, type: "array" },
      remote: { $ref: "https://example.com/schema.json" },
    },
    required: ["hits"],
    type: "object",
  }) as unknown as {
    properties: { structuredContent: { $defs: Record<string, { default: unknown }> } };
  };

  expect(schema.properties.structuredContent.$defs["Hit/v1"]?.default).toEqual({
    $ref: "#/stays",
  });
  expect(renderToolOutputType(schema as never)).toBe(
    `{ ${content} structuredContent?: { again?: Array<{ id: string; }>; children?: Array<{ again?: Array<{ id: string; }>; children?: Array<unknown>; default?: { id: string; }; hits: Array<{ id: string; }>; remote?: unknown; }>; default?: { id: string; }; hits: Array<{ id: string; }>; remote?: unknown; }; [key: string]: unknown; }`,
  );
};

const convertsResultsPassingTheCalltoolresultToScriptsPart1 = () =>
  Effect.gen(function* () {
    const blocks = [
      { name: "a", type: "resource_link" as const, uri: "file:///a" },
      { resource: { text: "b text", uri: "file:///b" }, type: "resource" as const },
      { data: "", mimeType: "audio/wav", type: "audio" as const },
    ];
    expect(
      yield* awaited(
        convertMcpResult("docs", "t", {
          _meta: { trace: "x" },
          content: blocks,
          structuredContent: { ok: true },
        }),
      ),
    ).toEqual({
      content: [
        { text: '[Resource file:///a "a"]', type: "text" },
        { text: "b text", type: "text" },
        { text: "[audio audio/wav omitted]", type: "text" },
      ],
      details: { server: "docs", tool: "t" },

      structuredContent: { content: blocks, structuredContent: { ok: true } },
    });
  });

const convertsResultsPassingTheCalltoolresultToScripts = Effect.gen(function* () {
  yield* convertsResultsPassingTheCalltoolresultToScriptsPart1();
  expect(
    (yield* awaited(convertMcpResult("docs", "t", { content: [], structuredContent: { n: 1 } })))
      .content,
  ).toEqual([{ text: '{\n  "n": 1\n}', type: "text" }]);

  expect(
    yield* awaited(convertMcpResult("docs", "t", { content: [], structuredContent: [{ id: 1 }] })),
  ).toEqual({
    content: [{ text: '[\n  {\n    "id": 1\n  }\n]', type: "text" }],
    details: { server: "docs", tool: "t" },
    structuredContent: { content: [], structuredContent: [{ id: 1 }] },
  });
  expect(
    yield* awaited(
      convertMcpResult("docs", "t", {
        content: [{ text: "nope", type: "text" }],
        isError: true,
      }),
    ),
  ).toEqual({
    content: [{ text: "nope", type: "text" }],
    details: { server: "docs", tool: "t" },
    isError: true,
    structuredContent: { content: [{ text: "nope", type: "text" }], isError: true },
  });
  expect(
    (yield* awaited(convertMcpResult("docs", "t", { content: [], isError: true }))).content,
  ).toEqual([{ text: "MCP tool docs/t returned an error", type: "text" }]);
});

const pointsResourceLinksToReadMcpResourcePart1 = () =>
  Effect.sync(() => {
    const saved: [string | Uint8Array, string][] = [];
    const saveOutput = (data: string | Uint8Array, extension: string) =>
      runTest(
        Effect.sync(() => {
          saved.push([data, extension]);
          return `/tmp/saved${extension}`;
        }),
      );
    return { saveOutput, saved };
  });

const pointsResourceLinksToReadMcpResource = Effect.gen(function* () {
  const { saveOutput, saved } = yield* pointsResourceLinksToReadMcpResourcePart1();
  const converted = yield* awaited(
    convertMcpResult(
      "docs",
      "t",
      {
        content: [
          {
            description: "How to use it",
            mimeType: "text/markdown",
            name: "guide",
            size: 2048,
            title: "The Guide",
            type: "resource_link",
            uri: "docs://guide",
          },
          {
            resource: {
              blob: "JVBERg==",
              mimeType: "application/pdf",
              uri: "file:///r/report.pdf",
            },
            type: "resource",
          },
          {
            resource: { blob: "AAAA", mimeType: "image/png", uri: "docs://logo" },
            type: "resource",
          },
        ],
      },
      { readableResources: true, saveOutput },
    ),
  );
  expect(converted.content).toEqual([
    {
      text: '[Resource docs://guide "The Guide" (text/markdown, 2.0KB): How to use it. Read it with read_mcp_resource (server "docs")]',
      type: "text",
    },
    {
      text: "[Binary resource file:///r/report.pdf (application/pdf, 4B) saved to /tmp/saved.pdf]",
      type: "text",
    },
    { data: "AAAA", mimeType: "image/png", type: "image" },
  ]);
  expect(saved).toEqual([[Buffer.from("%PDF"), ".pdf"]]);
});

const cutsTheMiddleOfModelFacingText = Effect.gen(function* () {
  const saved: (string | Uint8Array)[] = [];
  const saveOutput = (data: string | Uint8Array) =>
    runTest(
      Effect.sync(() => {
        saved.push(data);
        return "/tmp/full.txt";
      }),
    );
  const lines = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`);
  const full = lines.join("\n");
  const image = { data: "AAAA", mimeType: "image/png", type: "image" as const };
  const result = { content: [{ text: full, type: "text" as const }, image] };
  const converted = yield* awaited(convertMcpResult("docs", "snapshot", result, { saveOutput }));
  expect(converted.content).toHaveLength(2);
  const text = (converted.content[0] as { text: string }).text;

  expect(text).toMatch(
    new RegExp(
      `^Warning: truncated output \\(original token count: ${Math.ceil(full.length / 4)}\\)\nTotal output lines: 3000\n\nline 1\nline 2\n`,
      "u",
    ),
  );
  expect(text).toMatch(/…\d+ chars truncated…/u);
  expect(
    text.endsWith("line 3000\n\n[Full output: /tmp/full.txt (read it with offset/limit)]"),
  ).toBe(true);
  expect(Buffer.byteLength(text)).toBeLessThan(21 * 1024);
  expect(converted.content[1]).toEqual(image);
  expect(converted.details).toEqual({
    fullOutputPath: "/tmp/full.txt",
    server: "docs",
    tool: "snapshot",
  });
  expect(saved).toEqual([full]);
  expect(converted.structuredContent).toEqual(result);

  yield* awaited(
    convertMcpResult("docs", "small", { content: [{ text: "ok", type: "text" }] }, { saveOutput }),
  );
  expect(saved).toHaveLength(1);
});

const cutsMultiByteTextOnlyAtCharacter = () => {
  const text = `${"é".repeat(20_000)}end`;
  const result = truncateMiddle(text, 1001);
  expect(result.truncated).toBe(true);
  expect(result.content).not.toContain("\uFFFD");
  expect(result.content.endsWith("end")).toBe(true);
  const [head, tail] = result.content.split(/…\d+ chars truncated…/u);
  if (head === undefined || tail === undefined) throw new Error("expected a truncation marker");
  expect(Buffer.byteLength(head)).toBeLessThanOrEqual(500);
  expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(501);
  expect(Array.from(head).length + Array.from(tail).length + result.removedChars).toBe(
    Array.from(text).length,
  );
};

describe("MCP tools", () => {
  it("creates provider-safe tool names", createsProviderSafeToolNames);

  it(
    "declares the CallToolResult scripts receive, keeping references in the server's output schema",
    declaresTheCalltoolresultScriptsReceiveKeepingReferences,
  );

  it("converts results, passing the CallToolResult to scripts and flagging errors", () =>
    runTest(convertsResultsPassingTheCalltoolresultToScripts));

  it("points resource links to read_mcp_resource and saves binary resources", () =>
    runTest(pointsResourceLinksToReadMcpResource));

  it("cuts the middle of model-facing text over 20KB and keeps the full result for scripts", () =>
    runTest(cutsTheMiddleOfModelFacingText));

  it("cuts multi-byte text only at character boundaries", cutsMultiByteTextOnlyAtCharacter);
});
