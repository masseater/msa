import testing from "@msa/testing";
import { resetCapabilitiesCache } from "@msa/tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import { getReadmePath } from "../src/config.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import toolExecutionComponentSupport from "./tool-execution-component-support.ts";

const { createFakeTui } = toolExecutionComponentSupport;

const { joinPath, resolvePath } = testing;

const compactScenarios = [
  {
    absent: "read skill attio",
    compact: "[skill] attio",
    content: "---\nname: attio\ndescription: CRM helper\n---\n\n# Hidden skill instructions",
    hidden: "Hidden skill instructions",
    path: joinPath(process.cwd(), "attio", "SKILL.md"),
    title: "SKILL.md",
  },
  {
    absent: undefined,
    compact: "read resource .msa/AGENTS.md",
    content: "Hidden resource instructions",
    hidden: "Hidden resource instructions",
    path: joinPath(process.cwd(), ".msa", "AGENTS.md"),
    title: "AGENTS.md",
  },
  {
    absent: undefined,
    compact: "read resource .msa/AGENTS.override.md",
    content: "Hidden override instructions",
    hidden: "Hidden override instructions",
    path: joinPath(process.cwd(), ".msa", "AGENTS.override.md"),
    title: "AGENTS.override.md",
  },
  {
    absent: undefined,
    compact: `read resource ${resolvePath(process.cwd(), "..", "AGENTS.md").replace(/\\/gu, "/")}`,
    content: "Hidden outside resource instructions",
    hidden: "Hidden outside resource instructions",
    path: resolvePath(process.cwd(), "..", "AGENTS.md"),
    title: "outside AGENTS.md",
  },
  {
    absent: undefined,
    compact: "read docs README.md",
    content: "Hidden docs content",
    hidden: "Hidden docs content",
    path: getReadmePath(),
    title: "msa documentation",
  },
] as const;

const rangeScenarios = [
  {
    compact: "[skill] attio:120-329",
    path: joinPath(process.cwd(), "attio", "SKILL.md"),
    title: "SKILL.md",
  },
  { compact: "read docs README.md:120-329", path: getReadmePath(), title: "msa documentation" },
] as const;

const rendersCompactlyUntilExpanded = (scenario: (typeof compactScenarios)[number]) => {
  const component = new ToolExecutionComponent(
    "read",
    `tool-compact-${scenario.title}`,
    { path: scenario.path },
    {},
    createReadToolDefinition(process.cwd()),
    createFakeTui(),
    process.cwd(),
  );
  component.updateResult(
    {
      content: [{ text: scenario.content, type: "text" as const }],
      details: undefined,
      isError: false,
    },
    false,
  );

  const collapsed = stripAnsi(component.render(120).join("\n"));
  expect(collapsed).toContain(scenario.compact);
  expect(collapsed).not.toContain(scenario.hidden);
  if (scenario.absent !== undefined && scenario.absent.length > 0) {
    expect(collapsed).not.toContain(scenario.absent);
  }

  component.setExpanded(true);
  const expanded = stripAnsi(component.render(120).join("\n"));
  expect(expanded).toContain(scenario.hidden);
};

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  for (const scenario of compactScenarios) {
    test(`renders ${scenario.title} read results compactly until expanded`, () =>
      rendersCompactlyUntilExpanded(scenario));
  }

  for (const scenario of rangeScenarios) {
    test(`shows the read line range in compact ${scenario.title} reads before the expand hint`, () => {
      const component = new ToolExecutionComponent(
        "read",
        `tool-compact-range-${scenario.title}`,
        { limit: 210, offset: 120, path: scenario.path },
        {},
        createReadToolDefinition(process.cwd()),
        createFakeTui(),
        process.cwd(),
      );

      const collapsed = stripAnsi(component.render(120).join("\n"));
      expect(collapsed).toContain(scenario.compact);
      expect(collapsed.indexOf(":120-329")).toBeLessThan(collapsed.indexOf("to expand"));
    });
  }
});
