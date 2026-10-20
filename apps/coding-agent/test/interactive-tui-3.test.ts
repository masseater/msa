import testing from "@msa/testing";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import type { TuiMode } from "../src/core/settings-manager.ts";
import {
  BranchSummaryStatusIndicator,
  CompactionStatusIndicator,
  RetryStatusIndicator,
  type StatusIndicator,
  type StatusIndicatorKind,
  WorkingStatusIndicator,
} from "../src/modes/interactive/components/status-indicator.ts";
import {
  InteractiveMode,
  createInteractiveTui,
} from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import interactiveTuiSupport from "./interactive-tui-support.ts";

const { Container, Text } = tuiModule;

const { RecordingTerminal } = interactiveTuiSupport;

const { awaited, runTest } = testing;

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
  readClipboardFilePaths: vi.fn<() => Promise<string[] | null>>(),
  readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => clipboardMocks);

type RenderSessionEntriesContext = {
  renderer: ReturnType<typeof createInteractiveTui>;
  renderSessionItems: (items: unknown[]) => void;
};

const dropsTheFullscreenSelectionWhenSessionEntries = () =>
  runTest(
    Effect.gen(function* () {
      const terminal = new RecordingTerminal(40, 4);
      const ui = createInteractiveTui({
        fullscreenCopyOnSelect: false,
        logDirectory: "/tmp",
        showHardwareCursor: false,
        terminal,
        tuiMode: "fullscreen",
      });
      ui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
      const context: RenderSessionEntriesContext = { renderSessionItems: vi.fn(), renderer: ui };
      const { renderSessionEntries } = InteractiveMode.prototype as unknown as {
        renderSessionEntries(this: RenderSessionEntriesContext, entries: unknown[]): void;
      };

      ui.start();
      try {
        yield* awaited(terminal.waitForRender());
        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* awaited(terminal.waitForRender());
        expect(ui.hasActiveSelection()).toBe(true);

        renderSessionEntries.call(context, []);

        expect(ui.hasActiveSelection()).toBe(false);
      } finally {
        ui.stop();
      }
    }),
  );

describe("InteractiveMode transcript rebuild", () => {
  it(
    "drops the fullscreen selection when session entries are re-rendered",
    dropsTheFullscreenSelectionWhenSessionEntries,
  );
});

type StatusEditor = {
  embedWorkingStatus: boolean;
  setWorkingStatusIndicator: (indicator: StatusIndicator | undefined) => void;
};

type ClearStatusContext = {
  activeStatusIndicator: { kind: StatusIndicatorKind; dispose: () => void } | undefined;
  activeWorkingIndicatorEmbedded: boolean;
  statusContainer: tuiTypes.Container;
  defaultEditor: StatusEditor;
  editor: Partial<StatusEditor>;
  options: { tuiMode?: TuiMode };
  ui: { getClearOnShrink: () => boolean };
  idleStatus: tuiTypes.Component;
  setEditorWorkingStatusIndicator(indicator: StatusIndicator | undefined): boolean;
};

type InteractiveModePrototype = {
  showStatusIndicator(this: ClearStatusContext, indicator: StatusIndicator): void;
  clearStatusIndicator(this: ClearStatusContext, kind?: StatusIndicatorKind): void;
  setEditorWorkingStatusIndicator(
    this: ClearStatusContext,
    indicator: StatusIndicator | undefined,
  ): boolean;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

describe("clear-on-shrink status spacing", () => {
  it.each([true, false])(
    "routes every status through the editor opt-in (%s)",
    (embedWorkingStatus) => {
      initTheme("dark");
      const tui = { requestRender: vi.fn() } as unknown as tuiTypes.TUI;
      const editor: StatusEditor = { embedWorkingStatus, setWorkingStatusIndicator: vi.fn() };
      const context: ClearStatusContext = {
        activeStatusIndicator: undefined,
        activeWorkingIndicatorEmbedded: false,
        defaultEditor: { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() },
        editor,
        idleStatus: new Text("", 0, 0),
        options: { tuiMode: "regular" },
        setEditorWorkingStatusIndicator: interactiveModePrototype.setEditorWorkingStatusIndicator,
        statusContainer: new Container(),
        ui: { getClearOnShrink: () => true },
      };
      const indicators = [
        new WorkingStatusIndicator(tui, "Working"),
        new CompactionStatusIndicator(tui, "manual"),
        new CompactionStatusIndicator(tui, "threshold"),
        new CompactionStatusIndicator(tui, "overflow"),
        new BranchSummaryStatusIndicator(tui),
        new RetryStatusIndicator(tui, 1, 3, 1000),
      ];
      try {
        for (const indicator of indicators) {
          interactiveModePrototype.showStatusIndicator.call(context, indicator);
          expect(context.activeStatusIndicator).toBe(indicator);
          expect(context.activeWorkingIndicatorEmbedded).toBe(embedWorkingStatus);
          if (embedWorkingStatus) {
            expect(editor.setWorkingStatusIndicator).toHaveBeenLastCalledWith(indicator);
            expect(context.statusContainer.children).toHaveLength(0);
          } else {
            expect(context.statusContainer.children).toEqual([indicator]);
          }
        }
      } finally {
        for (const indicator of indicators) indicator.dispose();
      }
    },
  );
});

describe("clear-on-shrink status spacing", () => {
  it.each<StatusIndicatorKind>(["working", "compaction", "branchSummary", "retry"])(
    "does not reserve separate status height for an embedded %s indicator",
    (kind) => {
      const dispose = vi.fn();
      const editor: StatusEditor = { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() };
      const context: ClearStatusContext = {
        activeStatusIndicator: { dispose, kind },
        activeWorkingIndicatorEmbedded: true,
        defaultEditor: editor,
        editor,
        idleStatus: new Text("", 0, 0),
        options: { tuiMode: "regular" },
        setEditorWorkingStatusIndicator: interactiveModePrototype.setEditorWorkingStatusIndicator,
        statusContainer: new Container(),
        ui: { getClearOnShrink: () => true },
      };

      interactiveModePrototype.clearStatusIndicator.call(context);

      expect(dispose).toHaveBeenCalledOnce();
      expect(editor.setWorkingStatusIndicator).toHaveBeenCalledWith(undefined);
      expect(context.statusContainer.children).toHaveLength(0);
    },
  );
});

describe("clear-on-shrink status spacing", () => {
  it("uses the standalone row for a custom editor that has not opted in", () => {
    for (const [tuiMode, expectedChildren] of [
      ["regular", 1],
      ["fullscreen", 0],
    ] as const) {
      const defaultEditor: StatusEditor = {
        embedWorkingStatus: true,
        setWorkingStatusIndicator: vi.fn(),
      };
      const customEditor = { embedWorkingStatus: false, setWorkingStatusIndicator: vi.fn() };
      const context: ClearStatusContext = {
        activeStatusIndicator: { dispose: vi.fn(), kind: "working" as const },
        activeWorkingIndicatorEmbedded: false,
        defaultEditor,
        editor: customEditor,
        idleStatus: new Text("", 0, 0),
        options: { tuiMode },
        setEditorWorkingStatusIndicator: interactiveModePrototype.setEditorWorkingStatusIndicator,
        statusContainer: new Container(),
        ui: { getClearOnShrink: () => true },
      };

      interactiveModePrototype.clearStatusIndicator.call(context);

      expect(defaultEditor.setWorkingStatusIndicator).toHaveBeenCalledWith(undefined);
      expect(customEditor.setWorkingStatusIndicator).not.toHaveBeenCalled();
      expect(context.statusContainer.children).toHaveLength(expectedChildren);
    }
  });
});
