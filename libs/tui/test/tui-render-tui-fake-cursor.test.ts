import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { CURSOR_MARKER, renderFakeCursor, type TUI } from "../src/tui.ts";
import { sliceByColumn } from "../src/utils.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";

describe("TUI fake cursor", () => {
  it("draws the focused fake cursor in reverse video and omits it when the hardware cursor is shown", async () => {
    const terminal = new LoggingVirtualTerminal(20, 5);
    const tui: TUI = new TuiMainScreen(terminal);
    const input = new Input();
    input.setValue("abc");
    tui.addChild(input);
    tui.setFocus(input);
    tui.start();
    await terminal.waitForRender();
    assert.ok(terminal.getWrites().includes("> abc\x1b[7m \x1b[27m"));

    terminal.clearWrites();
    tui.setShowHardwareCursor(true);
    await terminal.waitForRender();
    assert.ok(!terminal.getWrites().includes("\x1b[7m"));
    assert.ok(!terminal.getWrites().includes("\x1b_pi:"));

    tui.stop();
  });

  it("keeps the fake cursor of an unfocused input when the hardware cursor is shown", async () => {
    const terminal = new LoggingVirtualTerminal(20, 5);
    const tui: TUI = new TuiMainScreen(terminal, true);
    const input = new Input();
    input.setValue("abc");
    tui.addChild(input);
    tui.start();
    await terminal.waitForRender();
    assert.ok(terminal.getWrites().includes("> abc\x1b[7m \x1b[27m"));
    tui.stop();
  });
});

describe("TUI fake cursor", () => {
  it("omits the focused fake cursor when truncation dropped its end marker", async () => {
    const terminal = new LoggingVirtualTerminal(20, 5);
    const tui: TUI = new TuiMainScreen(terminal, true);
    const base = new TestComponent();
    base.lines = [sliceByColumn(`ab${CURSOR_MARKER}${renderFakeCursor("c")}def`, 0, 3, true)];
    tui.addChild(base);
    tui.start();
    await terminal.waitForRender();
    assert.ok(!terminal.getWrites().includes("\x1b[7m"));
    assert.ok(terminal.getWrites().endsWith("\x1b[3G"));
    tui.stop();
  });

  it("keeps the cursor when an overlay ends directly left of it", async () => {
    for await (const showHardwareCursor of [false, true]) {
      const terminal = new LoggingVirtualTerminal(20, 5);
      const tui: TUI = new TuiMainScreen(terminal, showHardwareCursor);
      const base = new TestComponent();
      base.lines = [`abc${CURSOR_MARKER}${renderFakeCursor("d")}ef`];
      tui.addChild(base);
      const overlay = new TestComponent();
      overlay.lines = ["XXX"];
      tui.showOverlay(overlay, { row: 0, col: 0, width: 3 });
      tui.start();
      await terminal.waitForRender();

      const writes = terminal.getWrites();
      assert.ok(writes.includes("XXX"));
      assert.strictEqual(writes.includes("\x1b[7md"), !showHardwareCursor);
      // The hardware cursor is positioned at column 4 in both modes
      assert.ok(writes.endsWith("\x1b[4G"));
      tui.stop();
    }
  });
});
