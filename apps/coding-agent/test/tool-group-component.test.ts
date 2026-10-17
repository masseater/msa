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
    { content: [{ type: "text", text: "file body" }], details: undefined, isError: false },
    false,
  );
  return component;
}

function click(y: number, height: number): TuiMouseEvent {
  return {
    type: "click",
    button: "left",
    x: 2,
    y,
    screenX: 2,
    screenY: y,
    width,
    height,
    shift: false,
    alt: false,
    ctrl: false,
    clickCount: 1,
  };
}

describe("ToolGroupComponent", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  test("shows a single call as itself", () => {
    const group = new ToolGroupComponent(1);
    group.items.addChild(readCall("a", "a.txt"));
    expect(stripAnsi(group.render(width).join("\n"))).toContain("a.txt");
  });

  test("folds several calls into one line, then one line per call", () => {
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
  });

  test("folds thinking in with the calls, even beside a single call", () => {
    const thinking = new AssistantMessageComponent(
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "idea" }],
        api: "openai-responses",
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
        stopReason: "toolUse",
        timestamp: 0,
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
  });
});
