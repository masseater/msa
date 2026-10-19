import { awaited, runTest } from "@msa/testing";
import { resetCapabilitiesCache, setCapabilities, Text } from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import { type ToolDefinition } from "../src/core/extensions/types.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import {
  createBaseToolDefinition,
  createFakeTui,
  TINY_JPEG,
} from "./tool-execution-component-support.ts";

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test("converts non-PNG tool images once the transcoder loads", () =>
    runTest(
      Effect.gen(function* () {
        setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
        const component = new ToolExecutionComponent(
          "tool",
          "id",
          {},
          {},
          undefined,
          createFakeTui(),
          process.cwd(),
        );
        component.updateResult(
          {
            content: [{ type: "image" as const, data: "cGFydGlhbA==", mimeType: "image/jpeg" }],
            isError: false,
          },
          true,
        );
        component.updateResult({
          content: [{ type: "image" as const, data: TINY_JPEG, mimeType: "image/jpeg" }],
          isError: false,
        });

        yield* awaited(
          vi.waitFor(() => expect(component.render(120).join("\n")).toContain(";iVBORw0KGgo")),
        );
        const rendered = component.render(120).join("\n");
        expect(rendered).not.toContain("cGFydGlhbA==");

        component.invalidate();
        expect(component.render(120).join("\n")).toBe(rendered);
      }),
    ));

  test("stacks custom call and result renderers like the old implementation", () => {
    const toolDefinition: ToolDefinition = {
      ...createBaseToolDefinition(),
      renderCall: () => new Text("custom call", 0, 0),
      renderResult: () => new Text("custom result", 0, 0),
    };

    const component = new ToolExecutionComponent(
      "custom_tool",
      "tool-1",
      {},
      {},
      toolDefinition,
      createFakeTui(),
      process.cwd(),
    );
    expect(stripAnsi(component.render(120).join("\n"))).toContain("custom call");

    component.updateResult(
      {
        content: [{ type: "text" as const, text: "done" }],
        details: {},
        isError: false,
      },
      false,
    );

    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("custom call");
    expect(rendered).toContain("custom result");
  });

  test("self-rendered empty tool rows take no layout space", () => {
    const toolDefinition: ToolDefinition = {
      ...createBaseToolDefinition(),
      renderShell: "self",
      renderCall: () => new Text("", 0, 0),
      renderResult: () => new Text("", 0, 0),
    };

    const component = new ToolExecutionComponent(
      "custom_tool",
      "tool-empty-self-render",
      {},
      {},
      toolDefinition,
      createFakeTui(),
      process.cwd(),
    );
    expect(component.render(120)).toEqual([]);

    component.updateResult(
      {
        content: [],
        details: {},
        isError: false,
      },
      false,
    );

    expect(component.render(120)).toEqual([]);
  });

  test("preserves legacy file_path rendering compatibility for built-in tools", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-3",
      { file_path: "README.md" },
      {},
      undefined,
      createFakeTui(),
      process.cwd(),
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("read");
    expect(rendered).toContain("README.md");
  });

  test("does not duplicate built-in headers when passed the active built-in definition", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-4",
      { path: "README.md" },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
      process.cwd(),
    );
    component.updateResult(
      { content: [{ type: "text" as const, text: "hello" }], details: undefined, isError: false },
      false,
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered.match(/\bread\b/gu)?.length ?? 0).toBe(1);
  });

  test("renders read calls with null offset and limit as full-file reads", () => {
    const component = new ToolExecutionComponent(
      "read",
      "tool-read-null-range",
      { path: "src/example.ts", offset: null, limit: null },
      {},
      createReadToolDefinition(process.cwd()),
      createFakeTui(),
      process.cwd(),
    );
    const rendered = stripAnsi(component.render(120).join("\n"));
    expect(rendered).toContain("read src/example.ts");
    expect(rendered).not.toContain("src/example.ts:");
  });
});
