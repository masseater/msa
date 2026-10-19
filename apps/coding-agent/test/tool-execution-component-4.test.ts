import { resetCapabilitiesCache, Text } from "@msa/tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import { type ToolDefinition } from "../src/core/extensions/types.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
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

  test("exposes args in render result context", () => {
    const toolDefinition: ToolDefinition = {
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
      { content: [{ type: "text" as const, text: "done" }], details: {}, isError: false },
      false,
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("arg:bar");
  });

  test("trims trailing blank display lines from write previews", () => {
    const component = new ToolExecutionComponent(
      "write",
      "tool-7",
      { path: "README.md", content: "one\ntwo\n" },
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
  });

  test("trims trailing blank display lines from read results", () => {
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
        content: [{ type: "text" as const, text: "one\ntwo\n" }],
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
  });

  test("does not syntax-highlight read errors based on the requested file path", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-read-error-highlighting",
      { path: "config.exs", offset: 120, limit: 130 },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
      process.cwd(),
    );
    const error = "Offset 120 is beyond end of file (96 lines total)";
    component.updateResult(
      { content: [{ type: "text" as const, text: error }], details: undefined, isError: true },
      false,
    );

    const rendered = component.render(120).join("\n");
    expect(stripAnsi(rendered)).toContain(error);
    expect(rendered).toContain(theme.fg("toolOutput", error));
  });

  test("collapses ordinary read results until expanded", () => {
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
        content: [{ type: "text" as const, text: "hidden content" }],
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
  });
});
