import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import type { TUI } from "../src/tui.ts";
import { getCellItalic, renderAndFlush } from "./tui-overlay-style-leak-helpers.ts";
import { StaticLines } from "./tui-overlay-style-leak-static-lines.ts";
import { StaticOverlay } from "./tui-overlay-style-leak-static-overlay.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay compositing", () => {
  it("should not leak styles when a trailing reset sits beyond the last visible column (no overlay)", async () => {
    const width = 20;
    const baseLine = `\x1b[3m${"X".repeat(width)}\x1b[23m`;

    const terminal = new VirtualTerminal(width, 6);
    const tui: TUI = new TuiMainScreen(terminal);
    tui.addChild(new StaticLines([baseLine, "INPUT"]));
    tui.start();
    await renderAndFlush(tui, terminal);
    assert.strictEqual(getCellItalic(terminal, 1, 0), 0);
    tui.stop();
  });

  it("should not leak styles when overlay slicing drops trailing SGR resets", async () => {
    const width = 20;
    const baseLine = `\x1b[3m${"X".repeat(width)}\x1b[23m`;

    const terminal = new VirtualTerminal(width, 6);
    const tui: TUI = new TuiMainScreen(terminal);
    tui.addChild(new StaticLines([baseLine, "INPUT"]));

    tui.showOverlay(new StaticOverlay("OVR"), { row: 0, col: 5, width: 3 });
    tui.start();
    await renderAndFlush(tui, terminal);

    assert.strictEqual(getCellItalic(terminal, 1, 0), 0);
    tui.stop();
  });
});
