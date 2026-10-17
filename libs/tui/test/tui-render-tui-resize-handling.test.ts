import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { getCellItalic, withEnv } from "./tui-render-helpers.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI resize handling", () => {
  it("skips full re-render on height changes in Termux", async () => {
    await withEnv({ TERMUX_VERSION: "1" }, async () => {
      const terminal = new LoggingVirtualTerminal(40, 10);
      const tui: TUI = new TuiMainScreen(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = Array.from({ length: 20 }, (_, i) => `Line ${i}`);
      tui.start();
      await terminal.waitForRender();
      terminal.clearWrites();

      const initialRedraws = tui.fullRedraws;
      for await (const height of [15, 8, 14, 11]) {
        terminal.resize(40, height);
        await terminal.waitForRender();
      }

      assert.strictEqual(
        tui.fullRedraws,
        initialRedraws,
        "Height change should not trigger full redraw",
      );
      assert.ok(
        !terminal.getWrites().includes("\x1b[2J"),
        "Height change should not clear the screen",
      );
      assert.ok(
        !terminal.getWrites().includes("\x1b[3J"),
        "Height change should not clear scrollback",
      );

      const viewport = terminal.getViewport();
      assert.ok(
        viewport.join("\n").includes("Line 19"),
        "Latest content remains visible after resize",
      );

      tui.stop();
    });
  });
});

describe("TUI resize handling", () => {
  it("triggers full re-render when terminal width changes", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2"];
    tui.start();
    await terminal.waitForRender();

    const initialRedraws = tui.fullRedraws;

    terminal.resize(60, 10);
    await terminal.waitForRender();

    assert.ok(tui.fullRedraws > initialRedraws, "Width change should trigger full redraw");

    tui.stop();
  });
});

describe("TUI content shrinkage", () => {
  it("clears empty rows when content shrinks significantly", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    tui.setClearOnShrink(true);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4", "Line 5"];
    tui.start();
    await terminal.waitForRender();

    const initialRedraws = tui.fullRedraws;

    component.lines = ["Line 0", "Line 1"];
    tui.requestRender();
    await terminal.waitForRender();

    assert.ok(tui.fullRedraws > initialRedraws, "Content shrinkage should trigger full redraw");

    const viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("Line 0"), "First line preserved");
    assert.ok(viewport[1]?.includes("Line 1"), "Second line preserved");
    assert.strictEqual(viewport[2]?.trim(), "", "Line 2 should be cleared");
    assert.strictEqual(viewport[3]?.trim(), "", "Line 3 should be cleared");

    tui.stop();
  });
});

describe("TUI content shrinkage", () => {
  it("handles shrink to single line", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    tui.setClearOnShrink(true);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
    tui.start();
    await terminal.waitForRender();

    component.lines = ["Only line"];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    assert.ok(viewport[0]?.includes("Only line"), "Single line rendered");
    assert.strictEqual(viewport[1]?.trim(), "", "Line 1 should be cleared");

    tui.stop();
  });
});

describe("TUI content shrinkage", () => {
  it("handles shrink to empty", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    tui.setClearOnShrink(true);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2"];
    tui.start();
    await terminal.waitForRender();

    component.lines = [];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    assert.strictEqual(viewport[0]?.trim(), "", "Line 0 should be cleared");
    assert.strictEqual(viewport[1]?.trim(), "", "Line 1 should be cleared");

    tui.stop();
  });
});

describe("TUI differential rendering", () => {
  it("tracks cursor correctly when content shrinks with unchanged remaining lines", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4"];
    tui.start();
    await terminal.waitForRender();

    component.lines = ["Line 0", "Line 1", "Line 2"];
    tui.requestRender();
    await terminal.waitForRender();

    component.lines = ["Line 0", "CHANGED", "Line 2"];
    tui.requestRender();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    assert.ok(
      viewport[1]?.includes("CHANGED"),
      `Expected "CHANGED" on line 1, got: ${viewport[1]}`,
    );

    tui.stop();
  });
});

describe("TUI differential rendering", () => {
  it("renders correctly when only a middle line changes (spinner case)", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["Header", "Working...", "Footer"];
    tui.start();
    await terminal.waitForRender();

    const spinnerFrames = ["|", "/", "-", "\\"];
    for await (const frame of spinnerFrames) {
      component.lines = ["Header", `Working ${frame}`, "Footer"];
      tui.requestRender();
      await terminal.waitForRender();

      const viewport = terminal.getViewport();
      assert.ok(viewport[0]?.includes("Header"), `Header preserved: ${viewport[0]}`);
      assert.ok(viewport[1]?.includes(`Working ${frame}`), `Spinner updated: ${viewport[1]}`);
      assert.ok(viewport[2]?.includes("Footer"), `Footer preserved: ${viewport[2]}`);
    }

    tui.stop();
  });

  it("resets styles after each rendered line", async () => {
    const terminal = new VirtualTerminal(20, 6);
    const tui: TUI = new TuiMainScreen(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = ["\x1b[3mItalic", "Plain"];
    tui.start();
    await terminal.waitForRender();

    assert.strictEqual(getCellItalic(terminal, 1, 0), 0);
    tui.stop();
  });
});
