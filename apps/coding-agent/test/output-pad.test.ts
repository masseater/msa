import testing from "@msa/testing";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.ts";
import { CompactionSummaryMessageComponent } from "../src/modes/interactive/components/compaction-summary-message.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import tuiKit from "./tui-kit.ts";

const { TuiMainScreen } = tui;

const { VirtualTerminal, initTheme, stripAnsi } = tuiKit;

const { awaited, runTest } = testing;

const ui = new TuiMainScreen(new VirtualTerminal(80, 24));

const tool: ToolDefinition = {
  description: "custom tool",
  execute: () =>
    runTest(awaited({ content: [{ text: "ok", type: "text" as const }], details: {} })),
  label: "custom_tool",
  name: "custom_tool",
  parameters: Type.Any(),
};

type OutputPaddedComponent = tuiTypes.Component & { setOutputPad(outputPad: number): void };

function renderLines(component: tuiTypes.Component): string[] {
  return component
    .render(60)
    .map((line) => stripAnsi(line).trimEnd())
    .filter((line) => /[\w$(]/u.test(line));
}

function createTool(
  definition: ToolDefinition | undefined,
  outputPad: number,
): ToolExecutionComponent {
  const component = new ToolExecutionComponent(
    "custom_tool",
    "id",
    {},
    { outputPad },
    definition,
    ui,
    "/",
  );
  component.updateResult({ content: [{ text: "ok", type: "text" as const }], isError: false });
  return component;
}

const components: Array<{ name: string; create: (outputPad: number) => OutputPaddedComponent }> = [
  {
    create: (outputPad) => {
      const component = new BashExecutionComponent("pwd", ui, false, outputPad);
      component.appendOutput("/tmp");
      component.setComplete(1, false);
      return component;
    },
    name: "bash execution",
  },
  { create: (outputPad) => createTool(tool, outputPad), name: "tool execution" },
  {
    create: (outputPad) => createTool(undefined, outputPad),
    name: "tool execution without a definition",
  },
  {
    create: (outputPad) => {
      const component = new ToolExecutionComponent(
        "edit",
        "id",
        { edits: [{ newText: "new", oldText: "old" }], path: "file.txt" },
        { outputPad },
        createEditToolDefinition("/"),
        ui,
        "/",
      );
      component.updateResult({
        content: [{ text: "Could not find old text", type: "text" as const }],
        isError: true,
      });
      return component;
    },
    name: "self-rendered edit result",
  },
  {
    create: (outputPad) =>
      new CompactionSummaryMessageComponent(
        { role: "compactionSummary", summary: "summary", timestamp: 0, tokensBefore: 10 },
        undefined,
        outputPad,
      ),
    name: "compaction summary",
  },
];

describe("outputPad", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  afterAll(() => {
    ui.stop();
  });

  test.each(components)("$name renders at outputPad 0 and 1", ({ create }) => {
    const component = create(0);
    const lines = renderLines(component);
    expect(lines.filter((line) => line.startsWith(" "))).toEqual([]);
    component.setOutputPad(1);
    expect(renderLines(component)).toEqual(lines.map((line) => ` ${line}`));
  });
});
