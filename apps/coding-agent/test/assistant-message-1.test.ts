import type { AssistantMessage } from "@msa/ai";
import { currentTimeMillis } from "@msa/testing";
import type { TuiMouseEvent } from "@msa/tui";
import { describe, expect, test } from "vite-plus/test";

import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

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
  test("hands its thinking to another component, which follows later updates", () => {
    initTheme("dark");
    const toolCall = {
      type: "toolCall" as const,
      id: "tool-1",
      name: "read",
      arguments: { path: "file.txt" },
    };
    const message = createAssistantMessage(
      [
        { type: "thinking" as const, thinking: "first idea" },
        { type: "text" as const, text: "reading it" },
        toolCall,
      ],
      { stopReason: "toolUse" },
    );
    const component = new AssistantMessageComponent(message, true);

    const thinking = component.takeThinking();
    expect(thinking).toBeDefined();
    expect(component.takeThinking()).toBeUndefined();
    const text = stripAnsi(component.render(60).join("\n"));
    expect(text).toContain("reading it");
    expect(text).not.toContain("Thinking...");
    expect(stripAnsi(thinking!.render(60).join("\n"))).toContain("Thinking...");
    expect(thinking!.hasVisibleText()).toBe(false);

    thinking!.setHideThinkingBlock(false);
    component.updateContent(
      createAssistantMessage(
        [
          { type: "thinking" as const, thinking: "second idea" },
          { type: "text" as const, text: "reading it" },
          toolCall,
        ],
        { stopReason: "length" },
      ),
    );
    const thought = stripAnsi(thinking!.render(60).join("\n"));
    expect(thought).toContain("second idea");
    expect(thought).not.toContain("truncated");
  });
  test("keeps thinking that has no text beside it", () => {
    initTheme("dark");
    const component = new AssistantMessageComponent(
      createAssistantMessage([{ type: "thinking" as const, thinking: "idea" }]),
    );
    expect(component.takeThinking()).toBeUndefined();
  });
  test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
    initTheme("dark");

    const component = new AssistantMessageComponent(
      createAssistantMessage([{ type: "text" as const, text: "hello" }]),
    );
    const lines = component.render(40);

    expect(lines).not.toHaveLength(0);
    expect(lines[0]).toContain(OSC133_ZONE_START);
    expect(lines[lines.length - 1]?.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
  });
  test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
    initTheme("dark");

    const component = new AssistantMessageComponent(
      createAssistantMessage([
        { type: "text" as const, text: "calling tool" },
        { type: "toolCall" as const, id: "tool-1", name: "read", arguments: { path: "file.txt" } },
      ]),
    );
    const rendered = component.render(60).join("\n");

    expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
    expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
    expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
  });
  test("renders length stops with neutral truncation wording", () => {
    initTheme("dark");

    const component = new AssistantMessageComponent(
      createAssistantMessage([{ type: "thinking" as const, thinking: "private reasoning" }], {
        stopReason: "length",
      }),
      true,
    );
    const rendered = component.render(80).join("\n");

    expect(rendered).toContain("Thinking...");
    expect(rendered).toContain("Response was truncated before completion.");
  });
  test("coalesces adjacent thinking blocks into one hidden thinking label", () => {
    initTheme("dark");

    const component = new AssistantMessageComponent(
      createAssistantMessage([
        { type: "thinking" as const, thinking: "first thought" },
        { type: "thinking" as const, thinking: "" },
        { type: "thinking" as const, thinking: "second thought" },
        { type: "text" as const, text: "answer" },
      ]),
      true,
    );
    const rendered = stripAnsi(component.render(80).join("\n"));

    expect(rendered.match(/Thinking\.\.\./gu)).toHaveLength(1);
    expect(rendered).toContain("answer");
  });
  test("collapses individual thinking runs when clicked", () => {
    initTheme("dark");
    const component = new AssistantMessageComponent(
      createAssistantMessage([
        { type: "thinking" as const, thinking: "first reasoning" },
        { type: "text" as const, text: "answer" },
        { type: "thinking" as const, thinking: "second reasoning" },
      ]),
    );
    const width = 80;
    const lines = component.render(width);
    const firstThinkingRow = lines.findIndex((line) => stripAnsi(line).includes("first reasoning"));
    expect(firstThinkingRow).toBeGreaterThanOrEqual(0);
    const event: TuiMouseEvent = {
      type: "click" as const,
      button: "left",
      x: 1,
      y: firstThinkingRow,
      screenX: 1,
      screenY: firstThinkingRow,
      width,
      height: lines.length,
      shift: false,
      alt: false,
      ctrl: false,
      clickCount: 1,
    };
    expect(component.handleMouse(event)?.handled).toBe(true);

    const collapsed = stripAnsi(component.render(width).join("\n"));
    expect(collapsed).not.toContain("first reasoning");
    expect(collapsed).toContain("Thinking...");
    expect(collapsed).toContain("second reasoning");
  });
  test("uses configured output padding for text and thinking", () => {
    initTheme("dark");

    const component = new AssistantMessageComponent(
      createAssistantMessage([
        { type: "text" as const, text: "hello" },
        { type: "thinking" as const, thinking: "reasoning" },
      ]),
      false,
      undefined,
      "Thinking...",
      1,
    );
    const lines = component.render(80).map((line) => stripAnsi(line));

    expect(lines.some((line) => line.includes(" hello"))).toBe(true);
    expect(lines.some((line) => line.includes(" reasoning"))).toBe(true);

    component.setOutputPad(0);
    const updatedLines = component.render(80).map((line) => stripAnsi(line));
    expect(updatedLines.some((line) => line.startsWith("hello"))).toBe(true);
    expect(updatedLines.some((line) => line.startsWith("reasoning"))).toBe(true);
  });
  test("chains Markdown transformers in registration order", () => {
    initTheme("dark");
    const calls: string[] = [];
    const message = createAssistantMessage([
      { type: "text" as const, text: "The result is $x^2$." },
    ]);
    const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, [
      (markdown, context) => {
        calls.push("formula");
        expect(context).toEqual({
          messageType: "assistant",
          isStreaming: false,
          availableWidth: 78,
        });
        return markdown.replace("$x^2$", "x²");
      },
      (markdown) => {
        calls.push("suffix");
        return `${markdown} Done.`;
      },
    ]);

    expect(stripAnsi(component.render(80).join("\n"))).toContain("The result is x². Done.");
    expect(calls).toEqual(["formula", "suffix"]);
  });
  test("identifies partial assistant Markdown as streaming", () => {
    initTheme("dark");
    const streamingStates: boolean[] = [];
    const message = createAssistantMessage([{ type: "text" as const, text: "partial" }]);
    const component = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 1, [
      (markdown, context) => {
        streamingStates.push(context.isStreaming);
        return context.isStreaming ? markdown : `${markdown} transformed`;
      },
    ]);

    component.updateContent(message, true);
    expect(stripAnsi(component.render(80).join("\n"))).not.toContain("transformed");

    component.updateContent(message, false);
    expect(stripAnsi(component.render(80).join("\n"))).toContain("partial transformed");
    expect(streamingStates).toEqual([true, false]);
  });
});
