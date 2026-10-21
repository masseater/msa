import testing from "@msa/testing";
import tuiModule from "@msa/tui";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import tuiRenderer from "../src/modes/interactive/tui-renderer.ts";
import interactiveModeFake from "./interactive-mode-fake.ts";
import RecordingTerminal from "./interactive-tui-support.ts";

const { bindModeFake } = interactiveModeFake;

const { createInteractiveTui } = tuiRenderer;
const { Text } = tuiModule;
const { awaited, runTest } = testing;

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<void>>(),
  readClipboardFilePaths: vi.fn<() => Promise<string[] | null>>(),
  readClipboardText: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("../src/utils/clipboard.ts", () => ({ default: clipboardMocks }));

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
      ui.start();
      try {
        yield* awaited(terminal.waitForRender());
        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* awaited(terminal.waitForRender());
        expect(ui.hasActiveSelection()).toBe(true);

        bindModeFake(context).view.history.renderSessionEntries([]);

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
