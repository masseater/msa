import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { describe, expect, it, vi } from "vite-plus/test";

import codingAgent from "../src/index.ts";
import type codingAgentTypes from "../src/index.types.ts";
import type statusIndicatorTypes from "../src/modes/interactive/components/status-indicator.types.ts";
import statusIndicators from "../src/modes/interactive/components/status-indicators.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";

const { bindModeFake } = interactiveModeFake;

const {
  createBranchSummaryStatusIndicator,
  createCompactionStatusIndicator,
  createRetryStatusIndicator,
  createWorkingStatusIndicator,
} = statusIndicators;

const { initTheme } = codingAgent;

const { Container, Text } = tuiModule;

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
  readClipboardFilePaths: vi.fn<() => Promise<string[] | null>>(),
  readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => ({ default: clipboardMocks }));

type StatusEditor = {
  embedWorkingStatus: boolean;
  setWorkingStatusIndicator: (indicator: statusIndicatorTypes.StatusIndicator | undefined) => void;
};

type ClearStatusContext = {
  activeStatusIndicator:
    | { kind: statusIndicatorTypes.StatusIndicatorKind; dispose: () => void }
    | undefined;
  activeWorkingIndicatorEmbedded: boolean;
  statusContainer: tuiTypes.Container;
  defaultEditor: StatusEditor;
  editor: Partial<StatusEditor>;
  options: { tuiMode?: codingAgentTypes.TuiMode };
  ui: { getClearOnShrink: () => boolean };
  idleStatus: tuiTypes.Component;
};
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
        statusContainer: new Container(),
        ui: { getClearOnShrink: () => true },
      };
      const indicators = [
        createWorkingStatusIndicator({ message: "Working", ui: tui }),
        createCompactionStatusIndicator({ reason: "manual", ui: tui }),
        createCompactionStatusIndicator({ reason: "threshold", ui: tui }),
        createCompactionStatusIndicator({ reason: "overflow", ui: tui }),
        createBranchSummaryStatusIndicator(tui),
        createRetryStatusIndicator({ attempt: 1, delayMs: 1000, maxAttempts: 3, ui: tui }),
      ];
      try {
        for (const indicator of indicators) {
          bindModeFake(context).display.indicator.showStatusIndicator(indicator);
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
  it.each<statusIndicatorTypes.StatusIndicatorKind>([
    "working",
    "compaction",
    "branchSummary",
    "retry",
  ])("does not reserve separate status height for an embedded %s indicator", (kind) => {
    const dispose = vi.fn();
    const editor: StatusEditor = { embedWorkingStatus: true, setWorkingStatusIndicator: vi.fn() };
    const context: ClearStatusContext = {
      activeStatusIndicator: { dispose, kind },
      activeWorkingIndicatorEmbedded: true,
      defaultEditor: editor,
      editor,
      idleStatus: new Text("", 0, 0),
      options: { tuiMode: "regular" },
      statusContainer: new Container(),
      ui: { getClearOnShrink: () => true },
    };

    bindModeFake(context).display.indicator.clearStatusIndicator();

    expect(dispose).toHaveBeenCalledOnce();
    expect(editor.setWorkingStatusIndicator).toHaveBeenCalledWith(undefined);
    expect(context.statusContainer.children).toHaveLength(0);
  });
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
        statusContainer: new Container(),
        ui: { getClearOnShrink: () => true },
      };

      bindModeFake(context).display.indicator.clearStatusIndicator();

      expect(defaultEditor.setWorkingStatusIndicator).toHaveBeenCalledWith(undefined);
      expect(customEditor.setWorkingStatusIndicator).not.toHaveBeenCalled();
      expect(context.statusContainer.children).toHaveLength(expectedChildren);
    }
  });
});
