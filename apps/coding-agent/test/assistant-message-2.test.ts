import type { AssistantMessage } from "@msa/ai";
import { currentTimeMillis } from "@msa/testing";
import { describe, expect, test } from "vite-plus/test";

import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function createAssistantMessage(
  content: AssistantMessage["content"],
  overrides: Partial<Pick<AssistantMessage, "stopReason">> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses" as const,
    provider: "openai",
    model: "gpt-4o-mini",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: overrides.stopReason ?? "stop",
    timestamp: currentTimeMillis(),
  };
}

describe("AssistantMessageComponent", () => {
  test("reapplies Markdown transformers when available width changes", () => {
    initTheme("dark");
    const availableWidths: number[] = [];
    const component = new AssistantMessageComponent(
      createAssistantMessage([{ type: "text" as const, text: "answer" }]),
      false,
      undefined,
      "Thinking...",
      1,
      [
        (markdown, context) => {
          availableWidths.push(context.availableWidth);
          return `${markdown} (${context.availableWidth})`;
        },
      ],
    );

    expect(stripAnsi(component.render(80).join("\n"))).toContain("answer (78)");
    component.render(80);
    expect(stripAnsi(component.render(60).join("\n"))).toContain("answer (58)");
    expect(availableWidths).toEqual([78, 58]);
  });
  test("continues the Markdown transformer chain when a transformer throws", () => {
    initTheme("dark");
    const calls: string[] = [];
    const component = new AssistantMessageComponent(
      createAssistantMessage([{ type: "text" as const, text: "still visible" }]),
      false,
      undefined,
      "Thinking...",
      1,
      [
        (markdown) => {
          calls.push("first");
          return markdown.replace("still", "remains");
        },
        () => {
          calls.push("throw");
          throw new Error("broken transformer");
        },
        (markdown) => {
          calls.push("last");
          return `${markdown} after error`;
        },
      ],
    );

    expect(stripAnsi(component.render(80).join("\n"))).toContain("remains visible after error");
    expect(calls).toEqual(["first", "throw", "last"]);
  });
  test("transforms text and thinking Markdown without mutating the original message", () => {
    initTheme("dark");
    const message = createAssistantMessage([
      { type: "text" as const, text: "answer" },
      { type: "thinking" as const, thinking: "reasoning" },
    ]);
    const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, [
      (markdown, { messageType }) => `${messageType}:${markdown}`,
    ]);

    const rendered = stripAnsi(component.render(80).join("\n"));
    expect(rendered).toContain("assistant:answer");
    expect(rendered).toContain("assistant-thinking:reasoning");
    expect(message.content).toEqual([
      { type: "text" as const, text: "answer" },
      { type: "thinking" as const, thinking: "reasoning" },
    ]);
  });
  test("uses configured output padding for user messages", () => {
    initTheme("dark");

    const paddedComponent = new UserMessageComponent("hello", undefined, 1);
    const paddedLines = paddedComponent.render(40).map((line) => stripAnsi(line));
    expect(paddedLines.some((line) => line.startsWith(" hello"))).toBe(true);

    const unpaddedComponent = new UserMessageComponent("hello", undefined, 0);
    const unpaddedLines = unpaddedComponent.render(40).map((line) => stripAnsi(line));
    expect(unpaddedLines.some((line) => line.startsWith("hello"))).toBe(true);
  });
});
