import { describe, expect, it } from "vite-plus/test";

import mcp from "../src/index.ts";
import type mcpTypes from "../src/index.types.ts";

const { toLlmContent } = mcp;

describe("toLlmContent", () => {
  it("passes text and images through and replaces other blocks with text", () => {
    const blocks: mcpTypes.ContentBlock[] = [
      { annotations: { priority: 1 }, text: "hello", type: "text" },
      { _meta: { x: 1 }, data: "aW1n", mimeType: "image/png", type: "image" },
      { data: "YXVk", mimeType: "audio/wav", type: "audio" },
      { name: "a.txt", type: "resource_link", uri: "file:///a.txt" },
      { resource: { text: "inline", uri: "file:///b.txt" }, type: "resource" },
      { resource: { blob: "Yw==", mimeType: "image/png", uri: "file:///c.png" }, type: "resource" },
      { resource: { blob: "ZA==", uri: "file:///d.bin" }, type: "resource" },
    ];
    expect(toLlmContent({ content: blocks })).toEqual([
      { text: "hello", type: "text" },
      { data: "aW1n", mimeType: "image/png", type: "image" },
      { text: "[audio audio/wav omitted]", type: "text" },
      { text: "a.txt: file:///a.txt", type: "text" },
      { text: "inline", type: "text" },
      { data: "Yw==", mimeType: "image/png", type: "image" },
      { text: "[binary resource file:///d.bin (unknown type) omitted]", type: "text" },
    ]);
  });

  it("falls back to the structured content as JSON when there are no blocks", () => {
    expect(toLlmContent({ content: [], structuredContent: [1, 2] })).toEqual([
      { text: "[\n  1,\n  2\n]", type: "text" },
    ]);
    expect(toLlmContent({ content: [], structuredContent: null })).toEqual([
      { text: "null", type: "text" },
    ]);
    expect(toLlmContent({ content: [], structuredContent: { n: 1 } })).toEqual([
      { text: '{\n  "n": 1\n}', type: "text" },
    ]);
    expect(
      toLlmContent({ content: [{ text: "n=1", type: "text" }], structuredContent: { n: 1 } }),
    ).toEqual([{ text: "n=1", type: "text" }]);
  });
});
