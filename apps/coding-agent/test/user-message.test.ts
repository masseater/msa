import { describe, expect, test } from "vite-plus/test";

import UserMessageComponent from "../src/modes/interactive/components/user-message.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";

const { initTheme } = themeModule;
const { stripAnsi } = ansi;

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const BG_RESET = "\x1b[49m";

const keepsUserMessageHeightStableWhileMoving = () => {
  initTheme("dark");

  const component = new UserMessageComponent("hello");
  const lines = component.render(20);

  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain(OSC133_ZONE_START);
  expect(lines[0]?.endsWith(BG_RESET)).toBe(true);
  expect(lines[0]).not.toContain(OSC133_ZONE_END);
  expect(lines[1]).toContain("hello");
  expect(lines[2]?.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
  expect(lines[2]?.endsWith(BG_RESET)).toBe(true);
};

const chainsMarkdownTransformersWithUserMessageContext = () => {
  initTheme("dark");
  const calls: string[] = [];
  const component = new UserMessageComponent("The input is $x^2$.", undefined, 1, [
    (markdown, context) => {
      calls.push("formula");
      expect(context).toEqual({ availableWidth: 78, isStreaming: false, messageType: "user" });
      return markdown.replace("$x^2$", "x²");
    },
    (markdown) => {
      calls.push("suffix");
      return `${markdown} Done.`;
    },
  ]);

  expect(stripAnsi(component.render(80).join("\n"))).toContain("The input is x². Done.");
  expect(calls).toEqual(["formula", "suffix"]);
};

const reappliesMarkdownTransformersWhenInvalidated = () => {
  initTheme("dark");
  let suffix = "before";
  const component = new UserMessageComponent("Message", undefined, 1, [
    (markdown) => `${markdown} ${suffix}`,
  ]);

  expect(stripAnsi(component.render(80).join("\n"))).toContain("Message before");

  suffix = "after";
  component.invalidate();

  expect(stripAnsi(component.render(80).join("\n"))).toContain("Message after");
};

describe("UserMessageComponent", () => {
  test(
    "keeps user message height stable while moving closing OSC markers off line end",
    keepsUserMessageHeightStableWhileMoving,
  );

  test(
    "chains Markdown transformers with user message context",
    chainsMarkdownTransformersWithUserMessageContext,
  );

  test(
    "reapplies Markdown transformers when invalidated",
    reappliesMarkdownTransformersWhenInvalidated,
  );
});
