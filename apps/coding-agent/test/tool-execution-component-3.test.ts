import { resetCapabilitiesCache, Text, type TuiMouseEvent } from "@msa/tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import { type ToolDefinition } from "../src/core/extensions/types.ts";
import { createReadTool, createReadToolDefinition } from "../src/core/tools/read.ts";
import { withBuiltInRenderers } from "../src/core/tools/renderers/index.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createBaseToolDefinition, createFakeTui } from "./tool-execution-component-support.ts";

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test("uses built-in rendering for built-in overrides without custom renderers", () => {
    const overrideDefinition: ToolDefinition = {
      ...createBaseToolDefinition("edit"),
    };

    const component = new ToolExecutionComponent(
      "edit",
      "tool-2",
      { path: "README.md", oldText: "before", newText: "after" },
      {},
      withBuiltInRenderers("edit", overrideDefinition),
      createFakeTui(),
      process.cwd(),
    );
    component.updateResult({
      content: [],
      details: { diff: "+1 after", firstChangedLine: 1 },
      isError: false,
    });
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("edit");
    expect(rendered).toContain("README.md");
    expect(rendered).not.toContain(":1");
  });

  test("inherits missing built-in result renderer slot from the built-in tool", () => {
    const overrideDefinition: ToolDefinition = {
      ...createBaseToolDefinition("read"),
      renderCall: () => new Text("override call", 0, 0),
    };

    const component = new ToolExecutionComponent(
      "read",
      "tool-4b",
      { path: "notes.txt" },
      {},
      withBuiltInRenderers("read", overrideDefinition),
      createFakeTui(),
      process.cwd(),
    );
    component.updateResult(
      { content: [{ type: "text" as const, text: "hello" }], details: undefined, isError: false },
      false,
    );
    component.setExpanded(true);
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("override call");
    expect(rendered).toContain("hello");
  });

  test("inherits missing built-in call renderer slot from the built-in tool", () => {
    const overrideDefinition: ToolDefinition = {
      ...createBaseToolDefinition("read"),
      renderResult: () => new Text("override result", 0, 0),
    };

    const component = new ToolExecutionComponent(
      "read",
      "tool-4c",
      { path: "README.md" },
      {},
      withBuiltInRenderers("read", overrideDefinition),
      createFakeTui(),
      process.cwd(),
    );
    component.updateResult(
      { content: [{ type: "text" as const, text: "hello" }], details: undefined, isError: false },
      false,
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("read");
    expect(rendered).toContain("README.md");
    expect(rendered).toContain("override result");
  });

  test("uses custom renderers for built-in overrides that reuse built-in definition parameters", () => {
    const builtInDefinition = createReadToolDefinition(process.cwd());
    const component = new ToolExecutionComponent(
      "read",
      "tool-4d",
      { path: "README.md" },
      {},
      {
        ...builtInDefinition,
        renderCall: () => new Text("override call", 0, 0),
        renderResult: () => new Text("override result", 0, 0),
      },
      createFakeTui(),
      process.cwd(),
    );
    component.updateResult(
      { content: [{ type: "text" as const, text: "hello" }], details: undefined, isError: false },
      false,
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("override call");
    expect(rendered).toContain("override result");
    expect(rendered).not.toContain("read README.md");
  });

  test("uses custom renderers for built-in overrides that reuse wrapped built-in tool parameters", () => {
    const builtInTool = createReadTool(process.cwd());
    const component = new ToolExecutionComponent(
      "read",
      "tool-4e",
      { path: "README.md" },
      {},
      {
        ...createBaseToolDefinition("read"),
        parameters: builtInTool.parameters,
        renderCall: () => new Text("wrapped override call", 0, 0),
        renderResult: () => new Text("wrapped override result", 0, 0),
      },
      createFakeTui(),
      process.cwd(),
    );
    component.updateResult(
      { content: [{ type: "text" as const, text: "hello" }], details: undefined, isError: false },
      false,
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("wrapped override call");
    expect(rendered).toContain("wrapped override result");
  });

  test("shares renderer state across custom call and result slots", () => {
    type RenderState = { token?: string };
    const toolDefinition: ToolDefinition<any, unknown, RenderState> = {
      ...createBaseToolDefinition(),
      renderCall: (_args, _theme, context) => {
        context.state.token ??= "shared-token";
        return new Text(`custom call ${context.state.token}`, 0, 0);
      },
      renderResult: (_result, _options, _theme, context) =>
        new Text(`custom result ${context.state.token}`, 0, 0),
    };

    const component = new ToolExecutionComponent(
      "custom_tool",
      "tool-5",
      {},
      {},
      toolDefinition,
      createFakeTui(),
      process.cwd(),
    );
    component.updateResult(
      { content: [{ type: "text" as const, text: "done" }], details: {}, isError: false },
      false,
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("custom call shared-token");
    expect(rendered).toContain("custom result shared-token");
  });

  test("shows arguments in the fallback call header", () => {
    const longValue = "x".repeat(200);
    const component = new ToolExecutionComponent(
      "custom_tool",
      "tool-args",
      { query: "msa", long: longValue, text: "line one\nline two" },
      {},
      createBaseToolDefinition(),
      createFakeTui(),
      process.cwd(),
    );

    const collapsed = stripAnsi(component.render(300).join("\n"));
    expect(collapsed).toContain('custom_tool query="msa" long="xxx');
    expect(collapsed).toContain("...");
    expect(collapsed).not.toContain(longValue);

    component.setExpanded(true);
    const expanded = stripAnsi(component.render(300).join("\n"));
    expect(expanded).toContain("  query: msa");
    expect(expanded).toContain(longValue);
    const expandedLines = expanded.split("\n").map((line) => line.trimEnd());
    const textLine = expandedLines.findIndex((line) => line.endsWith("  text: line one"));
    expect(textLine).toBeGreaterThan(-1);
    expect(expandedLines[textLine + 1]).toMatch(/^\s+ {4}line two$/u);
  });

  test("collapses fallback results until expanded", () => {
    const toolDefinition: ToolDefinition = {
      ...createBaseToolDefinition(),
    };

    const component = new ToolExecutionComponent(
      "custom_tool",
      "tool-6",
      { foo: "bar" },
      {},
      toolDefinition,
      createFakeTui(),
      process.cwd(),
    );
    const output = Array.from({ length: 15 }, (_, index) => `line-${index + 1}`).join("\n");
    component.updateResult(
      { content: [{ type: "text" as const, text: output }], details: {}, isError: false },
      false,
    );

    const collapsed = stripAnsi(component.render(120).join("\n"));
    expect(collapsed).toContain("custom_tool");
    expect(collapsed).toMatch(/15 lines \(.* to expand\) {2}line-1\b/u);
    expect(collapsed).not.toContain("line-2");

    component.setExpanded(true);
    const expanded = stripAnsi(component.render(120).join("\n"));
    expect(expanded).toContain("line-15");
    expect(expanded).not.toContain("to expand");
  });

  test("expands a collapsed tool result when clicked", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-click-expand",
      { path: "notes.txt" },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
      process.cwd(),
    );
    component.updateResult(
      {
        content: [{ type: "text" as const, text: "hidden content" }],
        details: undefined,
        isError: false,
      },
      false,
    );
    const width = 120;
    const lines = component.render(width);
    const resultRow = lines.findIndex((line) => stripAnsi(line).includes("notes.txt"));
    expect(resultRow).toBeGreaterThanOrEqual(0);
    const event: TuiMouseEvent = {
      type: "click" as const,
      button: "left",
      x: 2,
      y: resultRow,
      screenX: 2,
      screenY: resultRow,
      width,
      height: lines.length,
      shift: false,
      alt: false,
      ctrl: false,
      clickCount: 1,
    };
    expect(component.handleMouse(event)?.handled).toBe(true);
    expect(stripAnsi(component.render(width).join("\n"))).toContain("hidden content");
  });
});
