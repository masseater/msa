import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;
const { initTheme } = themeModule;
const { stripAnsi } = ansi;

const { Container } = tui;

const { awaited, runTest } = testing;

const usesTheCacheMissNoticeSettingFor = () => {
  const usage: aiTypes.Usage = {
    cacheRead: 30,
    cacheWrite: 40,
    cost: { cacheRead: 0.03, cacheWrite: 0.065, input: 0.01, output: 0.02, total: 0.125 },
    input: 10,
    output: 20,
    totalTokens: 100,
  };
  initTheme("dark");
  const enabled = {
    chatContainer: new Container(),
    settingsManager: { display: { getShowCacheMissNotices: () => true } },
  };
  bindModeFake(enabled);
  bindModeFake(enabled).display.notices.usage.addCompactionCostNotice({
    kind: "compaction",
    type: "compaction_cost",
    usage,
  });
  bindModeFake(enabled);
  bindModeFake(enabled).display.notices.usage.addCompactionCostNotice({
    kind: "branch_summary",
    type: "compaction_cost",
    usage,
  });
  const output = stripAnsi(enabled.chatContainer.render(120).join("\n"));
  expect(output).toContain("Compaction: 100 tokens billed (~$0.13)");
  expect(output).toContain("Branch summary: 100 tokens billed (~$0.13)");

  const disabled = {
    chatContainer: new Container(),
    settingsManager: { display: { getShowCacheMissNotices: () => false } },
  };
  bindModeFake(disabled);
  bindModeFake(disabled).display.notices.usage.addCompactionCostNotice({
    kind: "compaction",
    type: "compaction_cost",
    usage,
  });
  expect(disabled.chatContainer.children).toHaveLength(0);
};

const rendersEachCompactionCostAfterItsSummaryPart1 = () => {
  const currentUsage: aiTypes.Usage = {
    cacheRead: 30,
    cacheWrite: 40,
    cost: { cacheRead: 0.03, cacheWrite: 0.04, input: 0.01, output: 0.02, total: 0.1 },
    input: 10,
    output: 20,
    totalTokens: 100,
  };
  const previousUsage: aiTypes.Usage = {
    cacheRead: 3,
    cacheWrite: 4,
    cost: { cacheRead: 0.003, cacheWrite: 0.004, input: 0.001, output: 0.002, total: 0.01 },
    input: 1,
    output: 2,
    totalTokens: 10,
  };
  return { currentUsage, previousUsage };
};

const rendersEachCompactionCostAfterItsSummary = () => {
  const { currentUsage, previousUsage } = rendersEachCompactionCostAfterItsSummaryPart1();
  const entries: sessionManagerTypes.SessionEntry[] = [
    {
      firstKeptEntryId: "kept",
      id: "current",
      parentId: "previous",
      summary: "current summary",
      timestamp: "2025-01-02T00:00:00Z",
      tokensBefore: 200,
      type: "compaction",
      usage: currentUsage,
    },
    {
      firstKeptEntryId: "kept",
      id: "previous",
      parentId: null,
      summary: "previous summary",
      timestamp: "2025-01-01T00:00:00Z",
      tokensBefore: 100,
      type: "compaction",
      usage: previousUsage,
    },
  ];
  const fakeThis = { renderSessionItems: vi.fn() };
  bindModeFake(fakeThis);
  bindModeFake(fakeThis).view.history.renderSessionEntries(entries);

  expect(fakeThis.renderSessionItems).toHaveBeenCalledWith(
    [
      expect.objectContaining({ role: "compactionSummary", summary: "current summary" }),
      { kind: "compaction", type: "compaction_cost", usage: currentUsage },
      expect.objectContaining({ role: "compactionSummary", summary: "previous summary" }),
      { kind: "compaction", type: "compaction_cost", usage: previousUsage },
    ],
    {},
  );
};

const rendersRetainedEntriesAndAppendsTheLatestStep1 = () =>
  Effect.sync(() => {
    const usage: aiTypes.Usage = {
      cacheRead: 30,
      cacheWrite: 40,
      cost: { cacheRead: 0.03, cacheWrite: 0.065, input: 0.01, output: 0.02, total: 0.125 },
      input: 10,
      output: 20,
      totalTokens: 100,
    };
    const latestCompaction: sessionManagerTypes.SessionEntry = {
      firstKeptEntryId: "kept",
      id: "latest",
      parentId: "previous",
      summary: "summary",
      timestamp: "2025-01-02T00:00:00Z",
      tokensBefore: 123,
      type: "compaction",
      usage,
    };
    const previousCompaction: sessionManagerTypes.SessionEntry = {
      firstKeptEntryId: "kept",
      id: "previous",
      parentId: null,
      summary: "previous summary",
      timestamp: "2025-01-01T00:00:00Z",
      tokensBefore: 100,
      type: "compaction",
      usage,
    };
    return { latestCompaction, previousCompaction, usage };
  });

const rendersRetainedEntriesAndAppendsTheLatestStep2 = (input: {
  readonly latestCompaction: sessionManagerTypes.CompactionEntry<unknown>;
  readonly previousCompaction: sessionManagerTypes.CompactionEntry<unknown>;
}) =>
  Effect.sync(() => {
    const { latestCompaction, previousCompaction } = input;
    const fakeThis = {
      addCompactionCostNotice: vi.fn(),
      addMessageToChat: vi.fn(),
      autoCompactionEscapeHandler: undefined as (() => void) | undefined,
      autoCompactionLoader: undefined,
      chatContainer: { clear: vi.fn() },
      clearStatusIndicator: vi.fn(),
      defaultEditor: {},
      flushCompactionQueue: vi.fn().mockResolvedValue(undefined),
      footer: { invalidate: vi.fn() },
      isInitialized: true,
      programStatus: { handleEvent: vi.fn() },
      renderSessionEntries: vi.fn(),
      sessionManager: {
        buildContextEntries: vi.fn().mockReturnValue([latestCompaction, previousCompaction]),
      },
      settingsManager: { terminal: { getShowTerminalProgress: () => false } },
      showError: vi.fn(),
      showStatus: vi.fn(),
      statusContainer: { clear: vi.fn() },
      ui: { requestRender: vi.fn(), terminal: { setProgress: vi.fn() } },
    };
    return { fakeThis };
  });

const rendersRetainedEntriesAndAppendsTheLatestStep3 = () =>
  Effect.gen(function* () {
    const { latestCompaction, previousCompaction, usage } =
      yield* rendersRetainedEntriesAndAppendsTheLatestStep1();
    const { fakeThis } = yield* rendersRetainedEntriesAndAppendsTheLatestStep2({
      latestCompaction,
      previousCompaction,
    });
    return { fakeThis, previousCompaction, usage };
  });

const rendersRetainedEntriesAndAppendsTheLatest = () =>
  runTest(
    Effect.gen(function* () {
      const { fakeThis, previousCompaction, usage } =
        yield* rendersRetainedEntriesAndAppendsTheLatestStep3();
      bindModeFake(fakeThis);
      yield* awaited(
        bindModeFake(fakeThis).lifecycle.events.handleEvent({
          aborted: false,
          reason: "manual",
          result: {
            firstKeptEntryId: "kept",
            summary: "summary",
            tokensBefore: 123,
            usage,
          },
          type: "compaction_end",
          willRetry: false,
        }),
      );

      expect(fakeThis.chatContainer.clear).toHaveBeenCalledTimes(1);
      expect(fakeThis.renderSessionEntries).toHaveBeenCalledWith([previousCompaction]);
      expect(fakeThis.addMessageToChat).toHaveBeenCalledTimes(1);
      expect(fakeThis.addMessageToChat).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "compactionSummary",
          summary: "summary",
          tokensBefore: 123,
        }),
      );
      expect(fakeThis.addCompactionCostNotice).toHaveBeenCalledWith({
        kind: "compaction",
        type: "compaction_cost",
        usage,
      });
      expect(fakeThis.flushCompactionQueue).toHaveBeenCalledWith({ willRetry: false });
    }),
  );

const updatesTheWorkingStateWhenTheSame = () =>
  runTest(
    Effect.gen(function* () {
      const fakeThis = {
        activeStatusIndicator: undefined,
        clearStatusIndicator: vi.fn(),
        footer: { invalidate: vi.fn() },
        isInitialized: true,
        programStatus: { handleEvent: vi.fn() },
        settingsManager: { terminal: { getShowTerminalProgress: () => true } },
        showWorkingStatusIndicator: vi.fn(),
        ui: { requestRender: vi.fn(), terminal: { setProgress: vi.fn() } },
        workingVisible: true,
      };
      bindModeFake(fakeThis);
      yield* awaited(bindModeFake(fakeThis).lifecycle.events.handleEvent({ type: "turn_start" }));

      expect(fakeThis.ui.terminal.setProgress).toHaveBeenCalledWith(true);
      expect(fakeThis.showWorkingStatusIndicator).toHaveBeenCalledTimes(1);
      expect(fakeThis.clearStatusIndicator).not.toHaveBeenCalled();
      expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);

      fakeThis.workingVisible = false;
      bindModeFake(fakeThis);
      yield* awaited(bindModeFake(fakeThis).lifecycle.events.handleEvent({ type: "turn_start" }));

      expect(fakeThis.showWorkingStatusIndicator).toHaveBeenCalledTimes(1);
      expect(fakeThis.clearStatusIndicator).toHaveBeenCalledTimes(1);
      expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(2);
    }),
  );

describe("InteractiveMode compaction events", () => {
  test(
    "uses the cache miss notice setting for compaction and branch summary costs",
    usesTheCacheMissNoticeSettingFor,
  );

  test("renders each compaction cost after its summary", rendersEachCompactionCostAfterItsSummary);

  test(
    "renders retained entries and appends the latest summary cost at the bottom",
    rendersRetainedEntriesAndAppendsTheLatest,
  );

  test(
    "updates the working state when the same agent run resumes after compaction",
    updatesTheWorkingStateWhenTheSame,
  );
});
