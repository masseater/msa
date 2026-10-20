import { Type } from "typebox";
import { describe, expect, test } from "vite-plus/test";

import type { Message, Tool, TranscriptContext } from "../src/types.ts";
import { getSystemMessageText, renderSystemMessageUpdate } from "../src/utils/text.ts";
import {
  collapseSystemMessages,
  declarationsEqual,
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getToolStateChanges,
  hasNonAdditiveToolChanges,
  hasToolRedefinitions,
  normalizeContext,
} from "../src/utils/transcript.ts";

function tool(name: string, description = `${name} tool`): Tool {
  return { description, name, parameters: Type.Object({}) };
}

const transcript = normalizeContext({
  messages: [
    {
      content: "base",
      role: "system",
      sections: { a: "<a>1</a>", b: "<b>1</b>" },
      timestamp: 10,
      toolsAdded: [tool("first")],
    },
    { content: "hello", role: "user", timestamp: 11 },
    { content: "also do this", role: "system", timestamp: 12 },
    { content: [{ text: "ok", type: "text" }], role: "assistant", timestamp: 13 } as never,
    {
      content: "",
      role: "system",
      sections: { a: "<a>2</a>", b: null, c: "<c>1</c>" },
      timestamp: 14,
      toolsAdded: [tool("second")],
      toolsRemoved: [{ name: "first" }],
    },
  ],
});

describe("system message replay", () => {
  test("replays content, sections, and tools into one leading message", () => {
    const current = getCurrentSystemMessage(transcript.messages);
    expect(current).toEqual({
      content: "base\n\nalso do this",
      role: "system",
      sections: { a: "<a>2</a>", c: "<c>1</c>" },
      timestamp: 10,
      toolsAdded: [tool("second")],
    });
    expect(getCurrentSystemPrompt(transcript.messages)).toBe(
      "base\n\nalso do this\n\n<a>2</a>\n\n<c>1</c>",
    );
  });

  test("collapse keeps only non-system messages after the replayed head", () => {
    const collapsed = collapseSystemMessages(transcript);
    expect(collapsed.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(collapseSystemMessages(collapsed)).toEqual(collapsed);
  });

  test("replay of a transcript without system messages is empty", () => {
    const context = normalizeContext({ messages: [{ content: "hi", role: "user", timestamp: 1 }] });
    expect(getCurrentSystemMessage(context.messages)).toBeUndefined();
    expect(getCurrentSystemPrompt(context.messages)).toBe("");
    expect(collapseSystemMessages(context).messages).toEqual(context.messages);
  });
});

describe("system message replay", () => {
  test("a late full patch on a transcript without a leading message replays as the prompt", () => {
    const context: TranscriptContext = normalizeContext({
      messages: [
        { content: "old session", role: "user", timestamp: 1 },
        {
          content: "",
          role: "system",
          sections: { preamble: "You are msa." },
          timestamp: 2,
          toolsAdded: [tool("x")],
        },
      ],
    });
    expect(getCurrentSystemPrompt(context.messages)).toBe("You are msa.");
    expect(collapseSystemMessages(context).messages[0]).toMatchObject({
      role: "system",
      toolsAdded: [tool("x")],
    });
  });
});

describe("system message replay", () => {
  test("renders complete prompts and framed updates", () => {
    const leading = transcript.messages[0];
    const update = transcript.messages[4];
    if (leading?.role !== "system" || update?.role !== "system")
      throw new Error("expected system messages");
    expect(getSystemMessageText(leading)).toBe("base\n\n<a>1</a>\n\n<b>1</b>");
    expect(renderSystemMessageUpdate(update)).toBe(
      [
        'Updated system prompt section "a":\n\n<a>2</a>',
        'Removed system prompt section "b".',
        'Updated system prompt section "c":\n\n<c>1</c>',
      ].join("\n\n"),
    );
  });

  test("normalizes the legacy prompt and tool fields into a leading system message", () => {
    const messages: Message[] = [{ content: "hi", role: "user", timestamp: 1 }];
    expect(normalizeContext({ messages })).toEqual({ messages });
    expect(normalizeContext({ messages, systemPrompt: "", tools: [] })).toEqual({ messages });
    expect(
      normalizeContext({ messages, systemPrompt: "be brief", tools: [tool("a")] }).messages,
    ).toEqual([
      { content: "be brief", role: "system", timestamp: 0, toolsAdded: [tool("a")] },
      ...messages,
    ]);
  });

  test("compares tool declarations without executable or undefined fields", () => {
    const executable = { ...tool("a"), constrainedSampling: undefined, execute: () => {} } as Tool;
    expect(declarationsEqual(executable, tool("a"))).toBe(true);
    expect(declarationsEqual(tool("a"), tool("a", "changed"))).toBe(false);
    expect(declarationsEqual(tool("a"), { ...tool("a"), constrainedSampling: false })).toBe(false);
  });

  test("tool state changes treat changed definitions as removal plus addition", () => {
    const changes = getToolStateChanges([tool("a"), tool("b")], [tool("b", "changed"), tool("c")]);
    expect(changes).toEqual({
      toolsAdded: [tool("b", "changed"), tool("c")],
      toolsRemoved: [{ name: "a" }, { name: "b" }],
    });
    expect(getToolStateChanges([tool("a")], [tool("a")])).toEqual({
      toolsAdded: [],
      toolsRemoved: [],
    });
  });
});

describe("system message replay", () => {
  test("detects non-additive tool history and redefinitions", () => {
    expect(hasNonAdditiveToolChanges(transcript.messages)).toBe(true);
    expect(hasToolRedefinitions(transcript.messages)).toBe(false);
    const additive = normalizeContext({
      messages: [
        { content: "", role: "system", timestamp: 1, toolsAdded: [tool("a")] },
        { content: "", role: "system", timestamp: 2, toolsAdded: [tool("b")] },
      ],
    });
    expect(hasNonAdditiveToolChanges(additive.messages)).toBe(false);
    const redeclared = normalizeContext({
      messages: [
        { content: "", role: "system", timestamp: 1, toolsAdded: [tool("a")] },
        { content: "", role: "system", timestamp: 2, toolsAdded: [tool("a", "changed")] },
      ],
    });
    expect(hasNonAdditiveToolChanges(redeclared.messages)).toBe(true);
    expect(hasToolRedefinitions(redeclared.messages)).toBe(true);
  });
});
