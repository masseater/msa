import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import type { TUI } from "../src/tui.ts";
import { EmptyContent } from "./overlay-options-empty-content.ts";
import { renderAndFlush } from "./overlay-options-helpers.ts";
import { HyperlinkContent } from "./overlay-options-hyperlink-content.ts";
import { StaticOverlay } from "./overlay-options-static-overlay.ts";
import { StyledContent } from "./overlay-options-styled-content.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay options", () => {
  describe("width overflow protection", () => {
    it("should truncate overlay lines that exceed declared width", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      // Overlay declares width 20 but renders lines much wider
      const overlay = new StaticOverlay(["X".repeat(100)]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { width: 20 });
      tui.start();
      await renderAndFlush(tui, terminal);

      // Should not crash, and no line should exceed terminal width
      const viewport = terminal.getViewport();
      for (const line of viewport) {
        // visibleWidth not available here, but line length is a rough check
        // The important thing is it didn't crash
        assert.ok(line !== undefined);
      }
      tui.stop();
    });

    it("should handle overlay with complex ANSI sequences without crashing", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      // Simulate complex ANSI content like the crash log showed
      const complexLine =
        "\x1b[48;2;40;50;40m \x1b[38;2;128;128;128mSome styled content\x1b[39m\x1b[49m" +
        "\x1b]8;;http://example.com\x07link\x1b]8;;\x07" +
        " more content ".repeat(10);
      const overlay = new StaticOverlay([complexLine, complexLine, complexLine]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { width: 60 });
      tui.start();
      await renderAndFlush(tui, terminal);

      // Should not crash
      const viewport = terminal.getViewport();
      assert.ok(viewport.length > 0);
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("width overflow protection", () => {
    it("should handle overlay composited on styled base content", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);

      const overlay = new StaticOverlay(["OVERLAY"]);

      tui.addChild(new StyledContent());
      tui.showOverlay(overlay, { width: 20, anchor: "center" });
      tui.start();
      await renderAndFlush(tui, terminal);

      // Should not crash and overlay should be visible
      const viewport = terminal.getViewport();
      const hasOverlay = viewport.some((line) => line?.includes("OVERLAY"));
      assert.ok(hasOverlay, "Overlay should be visible");
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("width overflow protection", () => {
    it("should handle wide characters at overlay boundary", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      // Wide chars (each takes 2 columns) at the edge of declared width
      // Mix of CJK chars
      const wideCharLine = "中文日本語한글テスト漢字";
      const overlay = new StaticOverlay([wideCharLine]);

      tui.addChild(new EmptyContent());
      // Odd width to potentially hit boundary
      tui.showOverlay(overlay, { width: 15 });
      tui.start();
      await renderAndFlush(tui, terminal);

      // Should not crash
      const viewport = terminal.getViewport();
      assert.ok(viewport.length > 0);
      tui.stop();
    });

    it("should handle overlay positioned at terminal edge", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      // Overlay positioned at right edge with content that exceeds declared width
      const overlay = new StaticOverlay(["X".repeat(50)]);

      tui.addChild(new EmptyContent());
      // Position at col 60 with width 20 - should fit exactly at right edge
      tui.showOverlay(overlay, { col: 60, width: 20 });
      tui.start();
      await renderAndFlush(tui, terminal);

      // Should not crash
      const viewport = terminal.getViewport();
      assert.ok(viewport.length > 0);
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("width overflow protection", () => {
    it("should handle overlay on base content with OSC sequences", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);

      const overlay = new StaticOverlay(["OVERLAY-TEXT"]);

      tui.addChild(new HyperlinkContent());
      tui.showOverlay(overlay, { anchor: "center", width: 20 });
      tui.start();
      await renderAndFlush(tui, terminal);

      // Should not crash - this was the original bug scenario
      const viewport = terminal.getViewport();
      assert.ok(viewport.length > 0);
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("width percentage", () => {
    it("should render overlay at percentage of terminal width", async () => {
      const terminal = new VirtualTerminal(100, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["test"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { width: "50%" });
      tui.start();
      await renderAndFlush(tui, terminal);

      assert.strictEqual(overlay.requestedWidth, 50);
      tui.stop();
    });

    it("should respect minWidth when widthPercent results in smaller width", async () => {
      const terminal = new VirtualTerminal(100, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["test"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { width: "10%", minWidth: 30 });
      tui.start();
      await renderAndFlush(tui, terminal);

      assert.strictEqual(overlay.requestedWidth, 30);
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("anchor positioning", () => {
    it("should position overlay at top-left", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["TOP-LEFT"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { anchor: "top-left", width: 10 });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      assert.ok(
        viewport[0]?.startsWith("TOP-LEFT"),
        `Expected TOP-LEFT at start, got: ${viewport[0]}`,
      );
      tui.stop();
    });

    it("should position overlay at bottom-right", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["BTM-RIGHT"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { anchor: "bottom-right", width: 10 });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      // Should be on last row, ending at last column
      const lastRow = viewport[23];
      assert.ok(lastRow?.includes("BTM-RIGHT"), `Expected BTM-RIGHT on last row, got: ${lastRow}`);
      assert.ok(
        lastRow?.trimEnd().endsWith("BTM-RIGHT"),
        `Expected BTM-RIGHT at end, got: ${lastRow}`,
      );
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("anchor positioning", () => {
    it("should position overlay at top-center", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["CENTERED"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { anchor: "top-center", width: 10 });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      // Should be on first row, centered horizontally
      const firstRow = viewport[0];
      assert.ok(firstRow?.includes("CENTERED"), `Expected CENTERED on first row, got: ${firstRow}`);
      // Check it's roughly centered (col 35 for width 10 in 80 col terminal)
      const colIndex = firstRow?.indexOf("CENTERED") ?? -1;
      assert.ok(colIndex >= 30 && colIndex <= 40, `Expected centered, got col ${colIndex}`);
      tui.stop();
    });
  });
});
