import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import { type ToolDefinition } from "../src/core/extensions/types.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import toolExecutionComponentSupport from "./tool-execution-component-support.ts";

const { Text, resetCapabilitiesCache } = tui;

const { createBaseToolDefinition, createFakeTui } = toolExecutionComponentSupport;

const sharesRendererStateAcrossCustomCallAnd = () => {
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
    { content: [{ text: "done", type: "text" as const }], details: {}, isError: false },
    false,
  );
  const rendered = stripAnsi(component.render(120).join("\n"));
  expect(rendered).toContain("custom call shared-token");
  expect(rendered).toContain("custom result shared-token");
};

const showsArgumentsInTheFallbackCallHeader = () => {
  const longValue = "x".repeat(200);
  const component = new ToolExecutionComponent(
    "custom_tool",
    "tool-args",
    Object.fromEntries([
      ["query", "msa"],
      ["long", longValue],
      ["text", "line one\nline two"],
    ]),
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
};

const collapsesFallbackResultsUntilExpanded = () => {
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
    { content: [{ text: output, type: "text" as const }], details: {}, isError: false },
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
};

const expandsACollapsedToolResultWhenClicked = () => {
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
      content: [{ text: "hidden content", type: "text" as const }],
      details: undefined,
      isError: false,
    },
    false,
  );
  const width = 120;
  const lines = component.render(width);
  const resultRow = lines.findIndex((line) => stripAnsi(line).includes("notes.txt"));
  expect(resultRow).toBeGreaterThanOrEqual(0);
  const event: tuiTypes.TuiMouseEvent = {
    alt: false,
    button: "left",
    clickCount: 1,
    ctrl: false,
    height: lines.length,
    screenX: 2,
    screenY: resultRow,
    shift: false,
    type: "click" as const,
    width,
    x: 2,
    y: resultRow,
  };
  expect(component.handleMouse(event)?.handled).toBe(true);
  expect(stripAnsi(component.render(width).join("\n"))).toContain("hidden content");
};

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test(
    "shares renderer state across custom call and result slots",
    sharesRendererStateAcrossCustomCallAnd,
  );

  test("shows arguments in the fallback call header", showsArgumentsInTheFallbackCallHeader);

  test("collapses fallback results until expanded", collapsesFallbackResultsUntilExpanded);
});

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test("expands a collapsed tool result when clicked", expandsACollapsedToolResultWhenClicked);
});
