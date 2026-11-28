import tui from "@msa/tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import read from "../src/core/tools/read.ts";
import renderers from "../src/core/tools/renderers/index.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import toolExecutionComponentSupport from "./tool-execution-component-support.ts";
const { withBuiltInRenderers } = renderers;
const { createReadTool, createReadToolDefinition } = read;
const { initTheme } = themeModule;

const { Text, resetCapabilitiesCache } = tui;

const { createBaseToolDefinition, createToolComponent, renderedText } =
  toolExecutionComponentSupport;

const usesBuiltInRenderingForBuiltIn = () => {
  const overrideDefinition: extensionsTypesTypes.ToolDefinition = {
    ...createBaseToolDefinition("edit"),
  };

  const component = createToolComponent(
    "edit",
    "tool-2",
    { newText: "after", oldText: "before", path: "README.md" },
    withBuiltInRenderers("edit", overrideDefinition),
  );
  component.updateResult({
    content: [],
    details: { diff: "+1 after", firstChangedLine: 1 },
    isError: false,
  });
  const rendered = renderedText(component);
  expect(rendered).toContain("edit");
  expect(rendered).toContain("README.md");
  expect(rendered).not.toContain(":1");
};

const inheritsMissingBuiltInResultRendererSlot = () => {
  const overrideDefinition: extensionsTypesTypes.ToolDefinition = {
    ...createBaseToolDefinition("read"),
    renderCall: () => new Text("override call", 0, 0),
  };

  const component = createToolComponent(
    "read",
    "tool-4b",
    { path: "notes.txt" },
    withBuiltInRenderers("read", overrideDefinition),
  );
  component.updateResult(
    { content: [{ text: "hello", type: "text" as const }], details: undefined, isError: false },
    false,
  );
  component.setExpanded(true);
  const rendered = renderedText(component);
  expect(rendered).toContain("override call");
  expect(rendered).toContain("hello");
};

const inheritsMissingBuiltInCallRendererSlot = () => {
  const overrideDefinition: extensionsTypesTypes.ToolDefinition = {
    ...createBaseToolDefinition("read"),
    renderResult: () => new Text("override result", 0, 0),
  };

  const component = createToolComponent(
    "read",
    "tool-4c",
    { path: "README.md" },
    withBuiltInRenderers("read", overrideDefinition),
  );
  component.updateResult(
    { content: [{ text: "hello", type: "text" as const }], details: undefined, isError: false },
    false,
  );
  const rendered = renderedText(component);
  expect(rendered).toContain("read");
  expect(rendered).toContain("README.md");
  expect(rendered).toContain("override result");
};

const usesCustomRenderersForBuiltInOverrides = () => {
  const builtInDefinition = createReadToolDefinition(process.cwd());
  const component = createToolComponent(
    "read",
    "tool-4d",
    { path: "README.md" },
    {
      ...builtInDefinition,
      renderCall: () => new Text("override call", 0, 0),
      renderResult: () => new Text("override result", 0, 0),
    },
  );
  component.updateResult(
    { content: [{ text: "hello", type: "text" as const }], details: undefined, isError: false },
    false,
  );
  const rendered = renderedText(component);
  expect(rendered).toContain("override call");
  expect(rendered).toContain("override result");
  expect(rendered).not.toContain("read README.md");
};

const usesCustomRenderersForBuiltInOverrides2 = () => {
  const builtInTool = createReadTool(process.cwd());
  const component = createToolComponent(
    "read",
    "tool-4e",
    { path: "README.md" },
    {
      ...createBaseToolDefinition("read"),
      parameters: builtInTool.parameters,
      renderCall: () => new Text("wrapped override call", 0, 0),
      renderResult: () => new Text("wrapped override result", 0, 0),
    },
  );
  component.updateResult(
    { content: [{ text: "hello", type: "text" as const }], details: undefined, isError: false },
    false,
  );
  const rendered = renderedText(component);
  expect(rendered).toContain("wrapped override call");
  expect(rendered).toContain("wrapped override result");
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
    "uses built-in rendering for built-in overrides without custom renderers",
    usesBuiltInRenderingForBuiltIn,
  );
});

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test(
    "inherits missing built-in result renderer slot from the built-in tool",
    inheritsMissingBuiltInResultRendererSlot,
  );
});

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test(
    "inherits missing built-in call renderer slot from the built-in tool",
    inheritsMissingBuiltInCallRendererSlot,
  );
});

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test(
    "uses custom renderers for built-in overrides that reuse built-in definition parameters",
    usesCustomRenderersForBuiltInOverrides,
  );
});

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test(
    "uses custom renderers for built-in overrides that reuse wrapped built-in tool parameters",
    usesCustomRenderersForBuiltInOverrides2,
  );
});
