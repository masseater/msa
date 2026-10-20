import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { beforeAll, describe, expect, test } from "vite-plus/test";

import { BranchSummaryMessageComponent } from "../src/modes/interactive/components/branch-summary-message.ts";
import { CompactionSummaryMessageComponent } from "../src/modes/interactive/components/compaction-summary-message.ts";
import { SkillInvocationMessageComponent } from "../src/modes/interactive/components/skill-invocation-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const { currentTimeMillis } = testing;

const WIDTH = 80;

function renderText(component: tuiTypes.Box): string {
  return stripAnsi(component.render(WIDTH).join("\n"));
}

function clickRow(component: tuiTypes.Box, marker: string): void {
  const lines = component.render(WIDTH);
  const row = lines.findIndex((line) => stripAnsi(line).includes(marker));
  expect(row).toBeGreaterThanOrEqual(0);
  const event: tuiTypes.TuiMouseEvent = {
    alt: false,
    button: "left",
    clickCount: 1,
    ctrl: false,
    height: lines.length,
    screenX: 2,
    screenY: row,
    shift: false,
    type: "click",
    width: WIDTH,
    x: 2,
    y: row,
  };
  expect(component.handleMouse(event)?.handled).toBe(true);
}

const togglesACompactionSummaryWhenClicked = () => {
  const component = new CompactionSummaryMessageComponent({
    role: "compactionSummary",
    summary: "compaction details",
    timestamp: currentTimeMillis(),
    tokensBefore: 1234,
  });

  expect(renderText(component)).not.toContain("compaction details");
  clickRow(component, "[compaction]");
  expect(renderText(component)).toContain("compaction details");
  clickRow(component, "[compaction]");
  expect(renderText(component)).not.toContain("compaction details");
};

const togglesABranchSummaryWhenClicked = () => {
  const component = new BranchSummaryMessageComponent({
    fromId: "entry-1",
    role: "branchSummary",
    summary: "branch details",
    timestamp: currentTimeMillis(),
  });

  expect(renderText(component)).not.toContain("branch details");
  clickRow(component, "[branch]");
  expect(renderText(component)).toContain("branch details");
  clickRow(component, "[branch]");
  expect(renderText(component)).not.toContain("branch details");
};

const togglesASkillInvocationWhenClicked = () => {
  const component = new SkillInvocationMessageComponent({
    content: "skill details",
    location: "/tmp/example-skill.md",
    name: "example-skill",
    userMessage: undefined,
  });

  expect(renderText(component)).not.toContain("skill details");
  clickRow(component, "[skill]");
  expect(renderText(component)).toContain("skill details");
  clickRow(component, "[skill]");
  expect(renderText(component)).not.toContain("skill details");
};

describe("collapsible message components", () => {
  beforeAll(() => initTheme("dark"));

  test("toggles a compaction summary when clicked", togglesACompactionSummaryWhenClicked);

  test("toggles a branch summary when clicked", togglesABranchSummaryWhenClicked);

  test("toggles a skill invocation when clicked", togglesASkillInvocationWhenClicked);
});
