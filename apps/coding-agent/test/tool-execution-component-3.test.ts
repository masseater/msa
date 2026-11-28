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

const hello = {
  content: [{ text: "hello", type: "text" as const }],
  details: undefined,
  isError: false,
};

interface ReadOverrideCase {
  args: { path: string };
  definition: () => extensionsTypesTypes.ToolDefinition;
  expanded: boolean;
  id: string;
  inheritsBuiltIn: boolean;
  name: string;
  notContains: string[];
  rendered: string[];
}

const readOverrideCases: ReadOverrideCase[] = [
  {
    args: { path: "notes.txt" },
    definition: () => ({
      ...createBaseToolDefinition("read"),
      renderCall: () => new Text("override call", 0, 0),
    }),
    expanded: true,
    id: "tool-4b",
    inheritsBuiltIn: true,
    name: "inherits missing built-in result renderer slot from the built-in tool",
    notContains: [],
    rendered: ["override call", "hello"],
  },
  {
    args: { path: "README.md" },
    definition: () => ({
      ...createBaseToolDefinition("read"),
      renderResult: () => new Text("override result", 0, 0),
    }),
    expanded: false,
    id: "tool-4c",
    inheritsBuiltIn: true,
    name: "inherits missing built-in call renderer slot from the built-in tool",
    notContains: [],
    rendered: ["read", "README.md", "override result"],
  },
  {
    args: { path: "README.md" },
    definition: () => ({
      ...createReadToolDefinition(process.cwd()),
      renderCall: () => new Text("override call", 0, 0),
      renderResult: () => new Text("override result", 0, 0),
    }),
    expanded: false,
    id: "tool-4d",
    inheritsBuiltIn: false,
    name: "uses custom renderers for built-in overrides that reuse built-in definition parameters",
    notContains: ["read README.md"],
    rendered: ["override call", "override result"],
  },
  {
    args: { path: "README.md" },
    definition: () => ({
      ...createBaseToolDefinition("read"),
      parameters: createReadTool(process.cwd()).parameters,
      renderCall: () => new Text("wrapped override call", 0, 0),
      renderResult: () => new Text("wrapped override result", 0, 0),
    }),
    expanded: false,
    id: "tool-4e",
    inheritsBuiltIn: false,
    name: "uses custom renderers for built-in overrides that reuse wrapped built-in tool parameters",
    notContains: [],
    rendered: ["wrapped override call", "wrapped override result"],
  },
];

const rendersReadOverride = ({
  args,
  definition,
  expanded,
  id,
  inheritsBuiltIn,
  notContains,
  rendered,
}: ReadOverrideCase) => {
  const component = createToolComponent(
    "read",
    id,
    args,
    inheritsBuiltIn ? withBuiltInRenderers("read", definition()) : definition(),
  );
  component.updateResult(hello, false);
  component.setExpanded(expanded);
  const text = renderedText(component);
  for (const expected of rendered) expect(text).toContain(expected);
  for (const unexpected of notContains) expect(text).not.toContain(unexpected);
};

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  test(
    "uses built-in rendering for built-in overrides without custom renderers",
    usesBuiltInRenderingForBuiltIn,
  );

  test.each(readOverrideCases)("$name", rendersReadOverride);
});
