import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { describe, expect, test } from "vite-plus/test";

import AssistantMessageComponent from "../src/modes/interactive/components/assistant-message.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";

const { initTheme } = themeModule;
const { stripAnsi } = ansi;

const { currentTimeMillis } = testing;

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function createAssistantMessage(
  content: aiTypes.AssistantMessage["content"],
  overrides: Partial<Pick<aiTypes.AssistantMessage, "stopReason">> = {},
): aiTypes.AssistantMessage {
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

const handsItsThinkingToAnotherComponentWhich = () => {
  initTheme("dark");
  const toolCall = {
    arguments: { path: "file.txt" },
    id: "tool-1",
    name: "read",
    type: "toolCall" as const,
  };
  const message = createAssistantMessage(
    [
      { thinking: "first idea", type: "thinking" as const },
      { text: "reading it", type: "text" as const },
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
        { thinking: "second idea", type: "thinking" as const },
        { text: "reading it", type: "text" as const },
        toolCall,
      ],
      { stopReason: "length" },
    ),
  );
  const thought = stripAnsi(thinking!.render(60).join("\n"));
  expect(thought).toContain("second idea");
  expect(thought).not.toContain("truncated");
};

const keepsThinkingThatHasNoTextBeside = () => {
  initTheme("dark");
  const component = new AssistantMessageComponent(
    createAssistantMessage([{ thinking: "idea", type: "thinking" as const }]),
  );
  expect(component.takeThinking()).toBeUndefined();
};

const addsOsc133ZoneMarkersToAssistant = () => {
  initTheme("dark");

  const component = new AssistantMessageComponent(
    createAssistantMessage([{ text: "hello", type: "text" as const }]),
  );
  const lines = component.render(40);

  expect(lines).not.toHaveLength(0);
  expect(lines[0]).toContain(OSC133_ZONE_START);
  expect(lines[lines.length - 1]?.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
};

const doesNotAddOsc133ZoneMarkers = () => {
  initTheme("dark");

  const component = new AssistantMessageComponent(
    createAssistantMessage([
      { text: "calling tool", type: "text" as const },
      { arguments: { path: "file.txt" }, id: "tool-1", name: "read", type: "toolCall" as const },
    ]),
  );
  const rendered = component.render(60).join("\n");

  expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
  expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
  expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
};

const rendersLengthStopsWithNeutralTruncationWording = () => {
  initTheme("dark");

  const component = new AssistantMessageComponent(
    createAssistantMessage([{ thinking: "private reasoning", type: "thinking" as const }], {
      stopReason: "length",
    }),
    true,
  );
  const rendered = component.render(80).join("\n");

  expect(rendered).toContain("Thinking...");
  expect(rendered).toContain("Response was truncated before completion.");
};

const coalescesAdjacentThinkingBlocksIntoOneHidden = () => {
  initTheme("dark");

  const component = new AssistantMessageComponent(
    createAssistantMessage([
      { thinking: "first thought", type: "thinking" as const },
      { thinking: "", type: "thinking" as const },
      { thinking: "second thought", type: "thinking" as const },
      { text: "answer", type: "text" as const },
    ]),
    true,
  );
  const rendered = stripAnsi(component.render(80).join("\n"));

  expect(rendered.match(/Thinking\.\.\./gu)).toHaveLength(1);
  expect(rendered).toContain("answer");
};

const collapsesIndividualThinkingRunsWhenClicked = () => {
  initTheme("dark");
  const component = new AssistantMessageComponent(
    createAssistantMessage([
      { thinking: "first reasoning", type: "thinking" as const },
      { text: "answer", type: "text" as const },
      { thinking: "second reasoning", type: "thinking" as const },
    ]),
  );
  const width = 80;
  const lines = component.render(width);
  const firstThinkingRow = lines.findIndex((line) => stripAnsi(line).includes("first reasoning"));
  expect(firstThinkingRow).toBeGreaterThanOrEqual(0);
  const event: tuiTypes.TuiMouseEvent = {
    alt: false,
    button: "left",
    clickCount: 1,
    ctrl: false,
    height: lines.length,
    screenX: 1,
    screenY: firstThinkingRow,
    shift: false,
    type: "click" as const,
    width,
    x: 1,
    y: firstThinkingRow,
  };
  expect(component.handleMouse(event)?.handled).toBe(true);

  const collapsed = stripAnsi(component.render(width).join("\n"));
  expect(collapsed).not.toContain("first reasoning");
  expect(collapsed).toContain("Thinking...");
  expect(collapsed).toContain("second reasoning");
};

const usesConfiguredOutputPaddingForTextAnd = () => {
  initTheme("dark");

  const component = new AssistantMessageComponent(
    createAssistantMessage([
      { text: "hello", type: "text" as const },
      { thinking: "reasoning", type: "thinking" as const },
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
};

const chainsMarkdownTransformersInRegistrationOrder = () => {
  initTheme("dark");
  const calls: string[] = [];
  const message = createAssistantMessage([{ text: "The result is $x^2$.", type: "text" as const }]);
  const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, [
    (markdown, context) => {
      calls.push("formula");
      expect(context).toEqual({
        availableWidth: 78,
        isStreaming: false,
        messageType: "assistant",
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
};

const identifiesPartialAssistantMarkdownAsStreaming = () => {
  initTheme("dark");
  const streamingStates: boolean[] = [];
  const message = createAssistantMessage([{ text: "partial", type: "text" as const }]);
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
};

describe("AssistantMessageComponent", () => {
  test(
    "hands its thinking to another component, which follows later updates",
    handsItsThinkingToAnotherComponentWhich,
  );
  test("keeps thinking that has no text beside it", keepsThinkingThatHasNoTextBeside);
  test(
    "adds OSC 133 zone markers to assistant messages without tool calls",
    addsOsc133ZoneMarkersToAssistant,
  );
  test(
    "does not add OSC 133 zone markers when assistant message contains tool calls",
    doesNotAddOsc133ZoneMarkers,
  );
  test(
    "renders length stops with neutral truncation wording",
    rendersLengthStopsWithNeutralTruncationWording,
  );
  test(
    "coalesces adjacent thinking blocks into one hidden thinking label",
    coalescesAdjacentThinkingBlocksIntoOneHidden,
  );
  test(
    "collapses individual thinking runs when clicked",
    collapsesIndividualThinkingRunsWhenClicked,
  );
  test(
    "uses configured output padding for text and thinking",
    usesConfiguredOutputPaddingForTextAnd,
  );
  test(
    "chains Markdown transformers in registration order",
    chainsMarkdownTransformersInRegistrationOrder,
  );
  test(
    "identifies partial assistant Markdown as streaming",
    identifiesPartialAssistantMarkdownAsStreaming,
  );
});
