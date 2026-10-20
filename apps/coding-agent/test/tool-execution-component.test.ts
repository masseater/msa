import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import { type ToolDefinition } from "../src/core/extensions/types.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import toolExecutionComponentSupport from "./tool-execution-component-support.ts";

const { Text, resetCapabilitiesCache, setCapabilities } = tui;

const { TINY_JPEG, createBaseToolDefinition, createFakeTui } = toolExecutionComponentSupport;

const { awaited, runTest } = testing;

const convertsNonPngToolImagesOnceThe = () =>
  runTest(
    Effect.gen(function* () {
      setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
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
          content: [{ data: "cGFydGlhbA==", mimeType: "image/jpeg", type: "image" as const }],
          isError: false,
        },
        true,
      );
      component.updateResult({
        content: [{ data: TINY_JPEG, mimeType: "image/jpeg", type: "image" as const }],
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
  );

const stacksCustomCallAndResultRenderersLike = () => {
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
      content: [{ text: "done", type: "text" as const }],
      details: {},
      isError: false,
    },
    false,
  );

  const rendered = stripAnsi(component.render(120).join("\n"));
  expect(rendered).toContain("custom call");
  expect(rendered).toContain("custom result");
};

const selfRenderedEmptyToolRowsTakeNo = () => {
  const toolDefinition: ToolDefinition = {
    ...createBaseToolDefinition(),
    renderCall: () => new Text("", 0, 0),
    renderResult: () => new Text("", 0, 0),
    renderShell: "self",
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
};

const preservesLegacyFilePathRenderingCompatibilityFor = () => {
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
};

const doesNotDuplicateBuiltInHeadersWhen = () => {
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
    { content: [{ text: "hello", type: "text" as const }], details: undefined, isError: false },
    false,
  );
  const rendered = stripAnsi(component.render(120).join("\n"));
  expect(rendered.match(/\bread\b/gu)?.length ?? 0).toBe(1);
};

const rendersReadCallsWithNullOffsetAnd = () => {
  const component = new ToolExecutionComponent(
    "read",
    "tool-read-null-range",
    { limit: null, offset: null, path: "src/example.ts" },
    {},
    createReadToolDefinition(process.cwd()),
    createFakeTui(),
    process.cwd(),
  );
  const rendered = stripAnsi(component.render(120).join("\n"));
  expect(rendered).toContain("read src/example.ts");
  expect(rendered).not.toContain("src/example.ts:");
};

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test("converts non-PNG tool images once the transcoder loads", convertsNonPngToolImagesOnceThe);

  test(
    "stacks custom call and result renderers like the old implementation",
    stacksCustomCallAndResultRenderersLike,
  );

  test("self-rendered empty tool rows take no layout space", selfRenderedEmptyToolRowsTakeNo);

  test(
    "preserves legacy file_path rendering compatibility for built-in tools",
    preservesLegacyFilePathRenderingCompatibilityFor,
  );

  test(
    "does not duplicate built-in headers when passed the active built-in definition",
    doesNotDuplicateBuiltInHeadersWhen,
  );

  test(
    "renders read calls with null offset and limit as full-file reads",
    rendersReadCallsWithNullOffsetAnd,
  );
});
