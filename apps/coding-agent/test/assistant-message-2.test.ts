import type { AssistantMessage } from "@msa/ai";
import testing from "@msa/testing";
import { describe, expect, test } from "vite-plus/test";

import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const { currentTimeMillis } = testing;

function createAssistantMessage(
  content: AssistantMessage["content"],
  overrides: Partial<Pick<AssistantMessage, "stopReason">> = {},
): AssistantMessage {
  return {
    api: "openai-responses" as const,
    content,
    model: "gpt-4o-mini",
    provider: "openai",
    role: "assistant",
    stopReason: overrides.stopReason ?? "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

const reappliesMarkdownTransformersWhenAvailableWidthChanges = () => {
  initTheme("dark");
  const availableWidths: number[] = [];
  const component = new AssistantMessageComponent(
    createAssistantMessage([{ text: "answer", type: "text" as const }]),
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
};

const continuesTheMarkdownTransformerChainWhenA = () => {
  initTheme("dark");
  const calls: string[] = [];
  const component = new AssistantMessageComponent(
    createAssistantMessage([{ text: "still visible", type: "text" as const }]),
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
};

const transformsTextAndThinkingMarkdownWithoutMutating = () => {
  initTheme("dark");
  const message = createAssistantMessage([
    { text: "answer", type: "text" as const },
    { thinking: "reasoning", type: "thinking" as const },
  ]);
  const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, [
    (markdown, { messageType }) => `${messageType}:${markdown}`,
  ]);

  const rendered = stripAnsi(component.render(80).join("\n"));
  expect(rendered).toContain("assistant:answer");
  expect(rendered).toContain("assistant-thinking:reasoning");
  expect(message.content).toEqual([
    { text: "answer", type: "text" as const },
    { thinking: "reasoning", type: "thinking" as const },
  ]);
};

const usesConfiguredOutputPaddingForUserMessages = () => {
  initTheme("dark");

  const paddedComponent = new UserMessageComponent("hello", undefined, 1);
  const paddedLines = paddedComponent.render(40).map((line) => stripAnsi(line));
  expect(paddedLines.some((line) => line.startsWith(" hello"))).toBe(true);

  const unpaddedComponent = new UserMessageComponent("hello", undefined, 0);
  const unpaddedLines = unpaddedComponent.render(40).map((line) => stripAnsi(line));
  expect(unpaddedLines.some((line) => line.startsWith("hello"))).toBe(true);
};

describe("AssistantMessageComponent", () => {
  test(
    "reapplies Markdown transformers when available width changes",
    reappliesMarkdownTransformersWhenAvailableWidthChanges,
  );
  test(
    "continues the Markdown transformer chain when a transformer throws",
    continuesTheMarkdownTransformerChainWhenA,
  );
  test(
    "transforms text and thinking Markdown without mutating the original message",
    transformsTextAndThinkingMarkdownWithoutMutating,
  );
  test(
    "uses configured output padding for user messages",
    usesConfiguredOutputPaddingForUserMessages,
  );
});
