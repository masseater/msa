import tui from "@msa/tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import read from "../src/core/tools/read.ts";
import write from "../src/core/tools/write.ts";
import ToolExecutionComponent from "../src/modes/interactive/components/tool-execution.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
import toolExecutionComponentSupport from "./tool-execution-component-support.ts";
const { stripAnsi } = ansi;
const { createWriteToolDefinition } = write;
const { createReadToolDefinition } = read;
const { initTheme, theme } = themeModule;

const { Text, resetCapabilitiesCache } = tui;

const { createBaseToolDefinition, createFakeTui } = toolExecutionComponentSupport;

const exposesArgsInRenderResultContext = () => {
  const toolDefinition: extensionsTypesTypes.ToolDefinition = {
    ...createBaseToolDefinition(),
    renderCall: () => new Text("call", 0, 0),
    renderResult: (_result, _options, _theme, context) =>
      new Text(`arg:${String((context.args as { foo: string }).foo)}`, 0, 0),
  };

  const component = new ToolExecutionComponent(
    "custom_tool",
    "tool-5b",
    { foo: "bar" },
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
  expect(rendered).toContain("arg:bar");
};

const trimsTrailingBlankDisplayLinesFromWrite = () => {
  const component = new ToolExecutionComponent(
    "write",
    "tool-7",
    { content: "one\ntwo\n", path: "README.md" },
    {},
    createWriteToolDefinition(process.cwd()),
    createFakeTui(),
    process.cwd(),
  );
  expect(stripAnsi(component.render(120).join("\n"))).toMatch(/2 lines \(.* to expand\)/u);
  component.setExpanded(true);
  const rendered = stripAnsi(component.render(120).join("\n"));
  expect(rendered).toContain("one");
  expect(rendered).toContain("two");
  expect(rendered).not.toContain("two\n\n");
};

const trimsTrailingBlankDisplayLinesFromRead = () => {
  const component = new ToolExecutionComponent(
    "read",
    "tool-8",
    { path: "notes.txt" },
    {},
    createReadToolDefinition(process.cwd()),
    createFakeTui(),
    process.cwd(),
  );
  component.updateResult(
    {
      content: [{ text: "one\ntwo\n", type: "text" as const }],
      details: undefined,
      isError: false,
    },
    false,
  );
  component.setExpanded(true);
  const rendered = stripAnsi(component.render(120).join("\n"));
  expect(rendered).toContain("one");
  expect(rendered).toContain("two");
  expect(rendered).not.toContain("two\n\n");
};

const doesNotSyntaxHighlightReadErrorsBased = () => {
  const component = new ToolExecutionComponent(
    "read",
    "tool-read-error-highlighting",
    { limit: 130, offset: 120, path: "config.exs" },
    {},
    createReadToolDefinition(process.cwd()),
    createFakeTui(),
    process.cwd(),
  );
  const error = "Offset 120 is beyond end of file (96 lines total)";
  component.updateResult(
    { content: [{ text: error, type: "text" as const }], details: undefined, isError: true },
    false,
  );

  const rendered = component.render(120).join("\n");
  expect(stripAnsi(rendered)).toContain(error);
  expect(rendered).toContain(theme.fg("toolOutput", error));
};

const collapsesOrdinaryReadResultsUntilExpanded = () => {
  const component = new ToolExecutionComponent(
    "read",
    "tool-ordinary-read-collapsed",
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

  const collapsed = stripAnsi(component.render(120).join("\n"));
  expect(collapsed).toContain("read");
  expect(collapsed).toContain("notes.txt");
  expect(collapsed).not.toContain("hidden content");

  component.setExpanded(true);
  const expanded = stripAnsi(component.render(120).join("\n"));
  expect(expanded).toContain("hidden content");
};

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test("exposes args in render result context", exposesArgsInRenderResultContext);

  test(
    "trims trailing blank display lines from write previews",
    trimsTrailingBlankDisplayLinesFromWrite,
  );

  test(
    "trims trailing blank display lines from read results",
    trimsTrailingBlankDisplayLinesFromRead,
  );

  test(
    "does not syntax-highlight read errors based on the requested file path",
    doesNotSyntaxHighlightReadErrorsBased,
  );

  test("collapses ordinary read results until expanded", collapsesOrdinaryReadResultsUntilExpanded);
});
