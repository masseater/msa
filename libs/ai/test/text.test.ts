import { describe, expect, it } from "vite-plus/test";

import ai from "../src/index.ts";
import type aiTypes from "../src/index.types.ts";

const { contentText } = ai;

const content: aiTypes.AssistantMessage["content"] = [
  { thinking: "reasoning", type: "thinking" },
  { text: "first", type: "text" },
  { arguments: {}, id: "1", name: "read", type: "toolCall" },
  { text: "second", type: "text" },
];

describe("contentText", () => {
  it("extracts assistant text blocks", () => {
    expect(contentText(content, "\n")).toBe("first\nsecond");
  });

  it("supports custom separators", () => {
    expect(contentText(content, "")).toBe("firstsecond");
  });

  it("passes string content through", () => {
    expect(contentText("hello", "\n")).toBe("hello");
  });

  it("extracts text from tool-result content", () => {
    const toolResultContent: aiTypes.ToolResultMessage["content"] = [
      { text: "first", type: "text" },
      { data: "...", mimeType: "image/png", type: "image" },
      { text: "second", type: "text" },
    ];

    expect(contentText(toolResultContent, "")).toBe("firstsecond");
  });
});
