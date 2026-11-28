import tui from "@msa/tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import read from "../src/core/tools/read.ts";
import write from "../src/core/tools/write.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
import toolExecutionComponentSupport from "./tool-execution-component-support.ts";
const { stripAnsi } = ansi;
const { createWriteToolDefinition } = write;
const { createReadToolDefinition } = read;
const { initTheme, theme } = themeModule;

const { Text, resetCapabilitiesCache } = tui;

const { createBaseToolDefinition, createToolComponent, renderedText } =
  toolExecutionComponentSupport;

const exposesArgsInRenderResultContext = () => {
  const toolDefinition: extensionsTypesTypes.ToolDefinition = {
    ...createBaseToolDefinition(),
    renderCall: () => new Text("call", 0, 0),
    renderResult: (_result, _options, _theme, context) =>
      new Text(`arg:${String((context.args as { foo: string }).foo)}`, 0, 0),
  };

  const component = createToolComponent("custom_tool", "tool-5b", { foo: "bar" }, toolDefinition);
  component.updateResult(
    { content: [{ text: "done", type: "text" as const }], details: {}, isError: false },
    false,
  );
  const rendered = renderedText(component);
  expect(rendered).toContain("arg:bar");
};

const trimsTrailingBlankDisplayLinesFromWrite = () => {
  const component = createToolComponent(
    "write",
    "tool-7",
    { content: "one\ntwo\n", path: "README.md" },
    createWriteToolDefinition(process.cwd()),
  );
  expect(renderedText(component)).toMatch(/2 lines \(.* to expand\)/u);
  component.setExpanded(true);
  const rendered = renderedText(component);
  expect(rendered).toContain("one");
  expect(rendered).toContain("two");
  expect(rendered).not.toContain("two\n\n");
};

const trimsTrailingBlankDisplayLinesFromRead = () => {
  const component = createToolComponent(
    "read",
    "tool-8",
    { path: "notes.txt" },
    createReadToolDefinition(process.cwd()),
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
  const rendered = renderedText(component);
  expect(rendered).toContain("one");
  expect(rendered).toContain("two");
  expect(rendered).not.toContain("two\n\n");
};

const doesNotSyntaxHighlightReadErrorsBased = () => {
  const component = createToolComponent(
    "read",
    "tool-read-error-highlighting",
    { limit: 130, offset: 120, path: "config.exs" },
    createReadToolDefinition(process.cwd()),
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
  const component = createToolComponent(
    "read",
    "tool-ordinary-read-collapsed",
    { path: "notes.txt" },
    createReadToolDefinition(process.cwd()),
  );
  component.updateResult(
    {
      content: [{ text: "hidden content", type: "text" as const }],
      details: undefined,
      isError: false,
    },
    false,
  );

  const collapsed = renderedText(component);
  expect(collapsed).toContain("read");
  expect(collapsed).toContain("notes.txt");
  expect(collapsed).not.toContain("hidden content");

  component.setExpanded(true);
  const expanded = renderedText(component);
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
