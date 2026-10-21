import { stripVTControlCharacters } from "node:util";

import testing from "@msa/testing";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import renderer from "../src/extensions/codemode/renderer.ts";
import type toolTypes from "../src/extensions/codemode/tool.types.ts";
import ToolExecutionComponent from "../src/modes/interactive/components/tool-execution.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";

const { codemodeRenderers } = renderer;
const { initTheme, theme } = themeModule;

const { runTest } = testing;

function render(
  result: toolTypes.CodemodeToolResult,
  isError = false,
  expanded = true,
  width = 200,
): string {
  const context = {
    args: { code: "" },
    argsComplete: true,
    cwd: "/",
    durationMs: undefined,
    executionStarted: true,
    expanded,
    invalidate: () => {},
    isError,
    isPartial: false,
    lastComponent: undefined,
    outputPad: 1,
    showImages: false,
    state: {},
    toolCallId: "call",
  } satisfies toolTypes.CodemodeRenderContext;
  const component = codemodeRenderers.renderResult?.(
    result,
    { expanded, isPartial: false },
    theme,
    context,
  ) as tuiTypes.Component;
  return stripVTControlCharacters(component.render(width).join("\n"))
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

const hidesTheScriptHeaderAndShowsThe = () => {
  const text = render({
    content: [
      { text: "Script completed\nWall time 0.1 seconds\nOutput:\n", type: "text" },
      { text: "hello", type: "text" },
    ],
    details: {
      calls: [{ args: '{"path":"a"}', durationMs: 5, id: "call/1", name: "read", status: "ok" }],
    },
  });
  expect(text).toBe('✓ read {"path":"a"} 5ms\n\nhello');
};

const showsTheCostOfModelCallsAnd = () => {
  const call = {
    args: "scorer/judge",
    durationMs: 5,
    name: "models.classify",
    status: "ok" as const,
  };
  const text = render({
    content: [{ text: "Script completed\nWall time 0.1 seconds\nOutput:\n", type: "text" }],
    details: {
      calls: [
        { ...call, cost: 0.000012936, id: "call/models.classify/1" },
        { ...call, cost: 0.02, id: "call/models.classify/2" },
        { ...call, id: "call/models.classify/3" },
      ],
    },
  });
  expect(text).toBe(
    [
      "✓ models.classify scorer/judge 5ms $0.000013",
      "✓ models.classify scorer/judge 5ms $0.02",
      "✓ models.classify scorer/judge 5ms",
      "Model calls: $0.02",
    ].join("\n"),
  );
};

const showsResultsWithoutAHeaderSuchAs = () => {
  const text = render(
    {
      content: [{ text: "The @options line must be followed by JavaScript source", type: "text" }],
      details: undefined,
    },
    true,
  );
  expect(text).toBe("The @options line must be followed by JavaScript source");
};

const collapsesToTheLatestCallAndOne = () => {
  const text = render(
    {
      content: [
        { text: "Script completed\nWall time 0.1 seconds\nOutput:\n", type: "text" },
        { text: `${"x".repeat(1000)}\nsecond line`, type: "text" },
      ],
      details: {
        calls: [
          { args: '{"path":"a"}', durationMs: 5, id: "call/1", name: "read", status: "ok" },
          { args: '{"pattern":"b"}', durationMs: 5, id: "call/2", name: "grep", status: "ok" },
        ],
        fullOutputPath: "/tmp/out.txt",
      },
    },
    false,
    false,
    80,
  );
  const lines = text.split("\n").filter(Boolean);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("grep");
  expect(lines[0]).toContain("+1 earlier calls");
  expect(lines[0]).not.toContain("read");
  expect(lines[1]).toMatch(/^2 lines \(.* to expand\) {2}x+/u);
  expect(lines[1]!.length).toBeLessThanOrEqual(80);
  expect(text).not.toContain("second line");
};

const showsTheElapsedTimeWhileTheScript = () =>
  runTest(
    Effect.gen(function* () {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const tui = { requestRender: () => {} } as unknown as tuiTypes.TUI;
      const component = new ToolExecutionComponent(
        "codemode",
        "call",
        { code: "" },
        {},
        codemodeRenderers,
        tui,
        "/",
      );
      const text = () => stripVTControlCharacters(component.render(120).join("\n"));
      component.markExecutionStarted();
      component.updateResult({ content: [], details: { calls: [] }, isError: false }, true);
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(3_000));
      expect(text()).toContain("Elapsed 3.0s");

      component.updateResult(
        { content: [], details: { calls: [] }, durationMs: 5_100, isError: false },
        false,
      );
      expect(text()).toContain("Took 5.1s");
      expect(text()).not.toContain("Elapsed");
    }),
  );

describe("codemode renderer", () => {
  beforeAll(() => initTheme("dark"));
  afterEach(() => vi.useRealTimers());

  it("hides the script header and shows the output", hidesTheScriptHeaderAndShowsThe);

  it("shows the cost of model calls and their total", showsTheCostOfModelCallsAnd);

  it("shows results without a header, such as rejected options", showsResultsWithoutAHeaderSuchAs);

  it("collapses to the latest call and one row of output", collapsesToTheLatestCallAndOne);

  it(
    "shows the elapsed time while the script runs and the total once it finished",
    showsTheElapsedTimeWhileTheScript,
  );
});
