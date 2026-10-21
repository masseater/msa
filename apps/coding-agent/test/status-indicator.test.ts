import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import codingAgent from "../src/index.ts";
import statusIndicators from "../src/modes/interactive/components/status-indicators.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";

const {
  createBranchSummaryStatusIndicator,
  createCompactionStatusIndicator,
  IdleStatus,
  createRetryStatusIndicator,
  createWorkingStatusIndicator,
} = statusIndicators;

const { CustomEditor } = codingAgent;

const { getEditorTheme, initTheme, theme } = themeModule;
const { stripAnsi } = ansi;

const { visibleWidth } = tuiModule;

const keepsIdleStatusAtTheSameHeight = () => {
  const idleStatus = new IdleStatus();

  const lines = idleStatus.render(20);
  expect(lines).toHaveLength(2);
  expect(lines).toEqual([" ".repeat(20), " ".repeat(20)]);
};

const keepsTheTopBorderUnchangedUnlessThe = () => {
  initTheme("dark");
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 10 },
  } as unknown as tuiTypes.TUI;
  const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create());
  const indicator = createWorkingStatusIndicator({ message: "Working", ui: tui });
  editor.setWorkingStatusIndicator(indicator);

  expect(stripAnsi(editor.render(20)[0]!)).toBe("─".repeat(20));
  const standaloneLine = indicator.render(20)[1]!;
  expect(standaloneLine).toContain(theme.getFgAnsi("accent"));
  expect(standaloneLine).toContain(theme.getFgAnsi("muted"));
  indicator.dispose();
};

const embedsTheWorkingIndicatorWhenTheEditor = () => {
  initTheme("dark");
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 10 },
  } as unknown as tuiTypes.TUI;
  const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
    embedWorkingStatus: true,
  });
  expect(editor.embedWorkingStatus).toBe(true);
  editor.borderColor = theme.getThinkingBorderColor("high");
  const indicator = createWorkingStatusIndicator({
    colorFn: (text) => editor.borderColor(text),
    message: "Working",
    ui: tui,
  });
  editor.setWorkingStatusIndicator(indicator);

  const topBorder = editor.render(20)[0]!;
  expect(stripAnsi(topBorder)).toBe("── ⠋ Working ───────");
  expect(visibleWidth(topBorder)).toBe(20);
  expect(topBorder.split(theme.getFgAnsi("thinkingHigh"))).toHaveLength(5);
  indicator.dispose();
};

const embedsCompactionSummaryAndRetryLabelsWithin = () => {
  initTheme("dark");
  vi.useFakeTimers();
  const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as tuiTypes.TUI;
  const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
    embedWorkingStatus: true,
  });
  const indicators = [
    createCompactionStatusIndicator({ reason: "manual", ui: tui }),
    createCompactionStatusIndicator({ reason: "threshold", ui: tui }),
    createCompactionStatusIndicator({ reason: "overflow", ui: tui }),
    createBranchSummaryStatusIndicator(tui),
    createRetryStatusIndicator({ attempt: 1, delayMs: 3000, maxAttempts: 3, ui: tui }),
  ];
  try {
    for (const indicator of indicators) {
      editor.setWorkingStatusIndicator(indicator);
      const label = stripAnsi(indicator.render(120)[1]!).trim();
      expect(stripAnsi(editor.render(120)[0]!)).toContain(`── ${label} `);
      for (const width of [1, 4, 10, 20, 80, 120]) {
        expect(visibleWidth(editor.render(width)[0]!)).toBe(width);
      }
    }
    vi.advanceTimersByTime(1000);
    expect(stripAnsi(editor.render(120)[0]!)).toContain("Retrying (1/3) in 2s");
    editor.setWorkingStatusIndicator(undefined);
    expect(stripAnsi(editor.render(120)[0]!)).toBe("─".repeat(120));
  } finally {
    for (const indicator of indicators) indicator.dispose();
  }
};

const disposesRetryCountdownUpdates = () => {
  initTheme("dark");
  vi.useFakeTimers();
  const requestRender = vi.fn();
  const tui = { requestRender } as unknown as tuiTypes.TUI;
  const indicator = createRetryStatusIndicator({
    attempt: 1,
    delayMs: 1000,
    maxAttempts: 3,
    ui: tui,
  });
  const callsBeforeDispose = requestRender.mock.calls.length;

  indicator.dispose();
  vi.advanceTimersByTime(2000);

  expect(requestRender).toHaveBeenCalledTimes(callsBeforeDispose);
};

describe("status indicators", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "keeps idle status at the same height as standalone status indicators",
    keepsIdleStatusAtTheSameHeight,
  );

  it(
    "keeps the top border unchanged unless the editor opts in",
    keepsTheTopBorderUnchangedUnlessThe,
  );

  it(
    "embeds the working indicator when the editor opts in",
    embedsTheWorkingIndicatorWhenTheEditor,
  );

  it(
    "embeds compaction, summary, and retry labels within the border width",
    embedsCompactionSummaryAndRetryLabelsWithin,
  );

  it("disposes retry countdown updates", disposesRetryCountdownUpdates);
});
