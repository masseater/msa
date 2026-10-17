import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { EmptyContent } from "./overlay-non-capturing-empty-content.ts";
import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush } from "./overlay-non-capturing-helpers.ts";
import { StaticOverlay } from "./overlay-non-capturing-static-overlay.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("focus() on already-focused overlay bumps visual order", async () => {
      const terminal = new VirtualTerminal(20, 6);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const aHandle = tui.showOverlay(new StaticOverlay(["A"]), {
          row: 0,
          col: 0,
          width: 1,
          nonCapturing: true,
        });
        tui.showOverlay(new StaticOverlay(["B"]), { row: 0, col: 0, width: 1, nonCapturing: true });
        aHandle.focus();
        tui.showOverlay(new StaticOverlay(["C"]), { row: 0, col: 0, width: 1, nonCapturing: true });
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "C");
        aHandle.focus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
        assert.strictEqual(aHandle.isFocused(), true);
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("default rendering order for overlapping overlays follows creation order", async () => {
      const terminal = new VirtualTerminal(20, 6);
      const tui: TUI = new TuiMainScreen(terminal);
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        tui.showOverlay(new StaticOverlay(["A"]), { row: 0, col: 0, width: 1, nonCapturing: true });
        tui.showOverlay(new StaticOverlay(["B"]), { row: 0, col: 0, width: 1, nonCapturing: true });
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
      } finally {
        tui.stop();
      }
    });

    it("focus() on lower overlay renders it on top", async () => {
      const terminal = new VirtualTerminal(20, 6);
      const tui: TUI = new TuiMainScreen(terminal);
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        const lower = tui.showOverlay(new StaticOverlay(["A"]), {
          row: 0,
          col: 0,
          width: 1,
          nonCapturing: true,
        });
        tui.showOverlay(new StaticOverlay(["B"]), { row: 0, col: 0, width: 1, nonCapturing: true });
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
        lower.focus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("focusing middle overlay places it on top while preserving others relative order", async () => {
      const terminal = new VirtualTerminal(20, 6);
      const tui: TUI = new TuiMainScreen(terminal);
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        tui.showOverlay(new StaticOverlay(["A"]), { row: 0, col: 0, width: 1, nonCapturing: true });
        const middle = tui.showOverlay(new StaticOverlay(["B"]), {
          row: 0,
          col: 0,
          width: 1,
          nonCapturing: true,
        });
        const top = tui.showOverlay(new StaticOverlay(["C"]), {
          row: 0,
          col: 0,
          width: 1,
          nonCapturing: true,
        });
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "C");
        middle.focus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
        middle.hide();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "C");
        top.hide();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("capturing overlay hidden and shown again renders on top after unhide", async () => {
      const terminal = new VirtualTerminal(20, 6);
      const tui: TUI = new TuiMainScreen(terminal);
      tui.addChild(new EmptyContent());
      tui.start();
      try {
        tui.showOverlay(new StaticOverlay(["A"]), { row: 0, col: 0, width: 1, nonCapturing: true });
        const capturing = tui.showOverlay(new StaticOverlay(["B"]), { row: 0, col: 0, width: 1 });
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
        capturing.setHidden(true);
        tui.showOverlay(new StaticOverlay(["C"]), { row: 0, col: 0, width: 1, nonCapturing: true });
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "C");
        capturing.setHidden(false);
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
      } finally {
        tui.stop();
      }
    });
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("unfocus() does not change visual order until another overlay is focused", async () => {
      const terminal = new VirtualTerminal(20, 6);
      const tui: TUI = new TuiMainScreen(terminal);
      const editor = new FocusableOverlay(["EDITOR"]);
      tui.addChild(new EmptyContent());
      tui.setFocus(editor);
      tui.start();
      try {
        const a = tui.showOverlay(new StaticOverlay(["A"]), {
          row: 0,
          col: 0,
          width: 1,
          nonCapturing: true,
        });
        const b = tui.showOverlay(new StaticOverlay(["B"]), {
          row: 0,
          col: 0,
          width: 1,
          nonCapturing: true,
        });
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
        a.focus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
        a.unfocus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
        b.focus();
        await renderAndFlush(tui, terminal);
        assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
      } finally {
        tui.stop();
      }
    });
  });
});
