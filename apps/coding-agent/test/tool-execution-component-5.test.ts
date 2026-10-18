import { joinPath, resolvePath } from "@msa/testing";
import { resetCapabilitiesCache } from "@msa/tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";

import { getReadmePath } from "../src/config.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createFakeTui } from "./tool-execution-component-support.ts";

describe("ToolExecutionComponent parity", () => {
  beforeAll(() => {
    initTheme("dark");
  });
  afterEach(() => {
    resetCapabilitiesCache();
    vi.useRealTimers();
  });

  for (const scenario of [
    {
      title: "SKILL.md",
      path: joinPath(process.cwd(), "attio", "SKILL.md"),
      content: "---\nname: attio\ndescription: CRM helper\n---\n\n# Hidden skill instructions",
      compact: "[skill] attio",
      hidden: "Hidden skill instructions",
      absent: "read skill attio",
    },
    {
      title: "AGENTS.md",
      path: joinPath(process.cwd(), ".msa", "AGENTS.md"),
      content: "Hidden resource instructions",
      compact: "read resource .msa/AGENTS.md",
      hidden: "Hidden resource instructions",
      absent: undefined,
    },
    {
      title: "AGENTS.override.md",
      path: joinPath(process.cwd(), ".msa", "AGENTS.override.md"),
      content: "Hidden override instructions",
      compact: "read resource .msa/AGENTS.override.md",
      hidden: "Hidden override instructions",
      absent: undefined,
    },
    {
      title: "outside AGENTS.md",
      path: resolvePath(process.cwd(), "..", "AGENTS.md"),
      content: "Hidden outside resource instructions",
      compact: `read resource ${resolvePath(process.cwd(), "..", "AGENTS.md").replace(/\\/gu, "/")}`,
      hidden: "Hidden outside resource instructions",
      absent: undefined,
    },
    {
      title: "msa documentation",
      path: getReadmePath(),
      content: "Hidden docs content",
      compact: "read docs README.md",
      hidden: "Hidden docs content",
      absent: undefined,
    },
  ] as const) {
    test(`renders ${scenario.title} read results compactly until expanded`, () => {
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
          content: [{ type: "text" as const, text: scenario.content }],
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
    });
  }

  for (const scenario of [
    {
      title: "SKILL.md",
      path: joinPath(process.cwd(), "attio", "SKILL.md"),
      compact: "[skill] attio:120-329",
    },
    { title: "msa documentation", path: getReadmePath(), compact: "read docs README.md:120-329" },
  ] as const) {
    test(`shows the read line range in compact ${scenario.title} reads before the expand hint`, () => {
      const component = new ToolExecutionComponent(
        "read",
        `tool-compact-range-${scenario.title}`,
        { path: scenario.path, offset: 120, limit: 210 },
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
