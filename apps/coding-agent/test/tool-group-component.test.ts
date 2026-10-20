import type { TUI, TuiMouseEvent } from "@msa/tui";
import { beforeAll, describe, expect, test } from "vite-plus/test";

import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { ToolGroupComponent } from "../src/modes/interactive/components/tool-group.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const width = 120;

function readCall(id: string, path: string): ToolExecutionComponent {
  const component = new ToolExecutionComponent(
    "read",
    id,
    { path },
    {},
    createReadToolDefinition(process.cwd()),
    { requestRender: () => {} } as unknown as TUI,
    process.cwd(),
  );
  component.updateResult(
    { content: [{ text: "file body", type: "text" }], details: undefined, isError: false },
    false,
  );
  return component;
}

function click(y: number, height: number): TuiMouseEvent {
  return {
    alt: false,
    button: "left",
    clickCount: 1,
    ctrl: false,
    height,
    screenX: 2,
    screenY: y,
    shift: false,
    type: "click",
    width,
    x: 2,
    y,
  };
}

const showsASingleCallAsItself = () => {
  const group = new ToolGroupComponent(1);
  group.items.addChild(readCall("a", "a.txt"));
  expect(stripAnsi(group.render(width).join("\n"))).toContain("a.txt");
};

const foldsSeveralCallsIntoOneLineThen = () => {
  const group = new ToolGroupComponent(1);
  group.items.addChild(readCall("a", "a.txt"));
  group.items.addChild(readCall("b", "b.txt"));

  const collapsed = group.render(width).map(stripAnsi);
  expect(collapsed).toEqual(["", " Read 2 files ›"]);

  expect(group.handleMouse(click(1, collapsed.length))?.handled).toBe(true);
  const listed = group.render(width).map(stripAnsi);
  expect(listed).toEqual(["", " Read 2 files ⌄", " read a.txt ›", " read b.txt ›"]);

  expect(group.handleMouse(click(2, listed.length))?.handled).toBe(true);
  expect(group.render(width).length).toBeGreaterThan(listed.length);
};

const foldsThinkingInWithTheCallsEven = () => {
  const thinking = new AssistantMessageComponent(
    {
      api: "openai-responses",
      content: [{ thinking: "idea", type: "thinking" }],
      model: "gpt-4o-mini",
      provider: "openai",
      role: "assistant",
      stopReason: "toolUse",
      timestamp: 0,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    true,
  );
  const group = new ToolGroupComponent(1);
  group.items.addChild(thinking);
  group.items.addChild(readCall("a", "a.txt"));

  const collapsed = group.render(width).map(stripAnsi);
  expect(collapsed).toEqual(["", " Thought, read 1 file ›"]);

  expect(group.handleMouse(click(1, collapsed.length))?.handled).toBe(true);
  expect(group.render(width).map((line) => stripAnsi(line).trimEnd())).toEqual([
    "",
    " Thought, read 1 file ⌄",
    "",
    " Thinking...",
    " read a.txt ›",
  ]);
};

describe("ToolGroupComponent", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test("shows a single call as itself", showsASingleCallAsItself);

  test(
    "folds several calls into one line, then one line per call",
    foldsSeveralCallsIntoOneLineThen,
  );

  test(
    "folds thinking in with the calls, even beside a single call",
    foldsThinkingInWithTheCallsEven,
  );
});
