import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import type { TUI } from "../src/tui.ts";
import { EmptyContent } from "./overlay-options-empty-content.ts";
import { renderAndFlush } from "./overlay-options-helpers.ts";
import { StaticOverlay } from "./overlay-options-static-overlay.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay options", () => {
  describe("margin", () => {
    it("should clamp negative margins to zero", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["NEG-MARGIN"]);

      tui.addChild(new EmptyContent());
      // Negative margins should be treated as 0
      tui.showOverlay(overlay, {
        anchor: "top-left",
        width: 12,
        margin: { top: -5, left: -10, right: 0, bottom: 0 },
      });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      // Should be at row 0, col 0 (negative margins clamped to 0)
      assert.ok(
        viewport[0]?.startsWith("NEG-MARGIN"),
        `Expected NEG-MARGIN at start of row 0, got: ${viewport[0]}`,
      );
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("margin", () => {
    it("should respect margin as number", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["MARGIN"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { anchor: "top-left", width: 10, margin: 5 });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      // Should be on row 5 (not 0) due to margin
      assert.ok(!viewport[0]?.includes("MARGIN"), "Should not be on row 0");
      assert.ok(!viewport[4]?.includes("MARGIN"), "Should not be on row 4");
      assert.ok(viewport[5]?.includes("MARGIN"), `Expected MARGIN on row 5, got: ${viewport[5]}`);
      // Should start at col 5 (not 0)
      const colIndex = viewport[5]?.indexOf("MARGIN") ?? -1;
      assert.strictEqual(colIndex, 5, `Expected col 5, got ${colIndex}`);
      tui.stop();
    });

    it("should respect margin object", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["MARGIN"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, {
        anchor: "top-left",
        width: 10,
        margin: { top: 2, left: 3, right: 0, bottom: 0 },
      });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      assert.ok(viewport[2]?.includes("MARGIN"), `Expected MARGIN on row 2, got: ${viewport[2]}`);
      const colIndex = viewport[2]?.indexOf("MARGIN") ?? -1;
      assert.strictEqual(colIndex, 3, `Expected col 3, got ${colIndex}`);
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("offset", () => {
    it("should apply offsetX and offsetY from anchor position", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["OFFSET"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { anchor: "top-left", width: 10, offsetX: 10, offsetY: 5 });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      assert.ok(viewport[5]?.includes("OFFSET"), `Expected OFFSET on row 5, got: ${viewport[5]}`);
      const colIndex = viewport[5]?.indexOf("OFFSET") ?? -1;
      assert.strictEqual(colIndex, 10, `Expected col 10, got ${colIndex}`);
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("percentage positioning", () => {
    it("should position with rowPercent and colPercent", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["PCT"]);

      tui.addChild(new EmptyContent());
      // 50% should center both ways
      tui.showOverlay(overlay, { width: 10, row: "50%", col: "50%" });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      // Find the row with PCT
      let foundRow = -1;
      for (let i = 0; i < viewport.length; i++) {
        if (viewport[i]?.includes("PCT")) {
          foundRow = i;
          break;
        }
      }
      // Should be roughly centered vertically (row ~11-12 for 24 row terminal)
      assert.ok(foundRow >= 10 && foundRow <= 13, `Expected centered row, got ${foundRow}`);
      tui.stop();
    });

    it("rowPercent 0 should position at top", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["TOP"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { width: 10, row: "0%" });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      assert.ok(viewport[0]?.includes("TOP"), `Expected TOP on row 0, got: ${viewport[0]}`);
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("percentage positioning", () => {
    it("rowPercent 100 should position at bottom", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["BOTTOM"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { width: 10, row: "100%" });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      assert.ok(
        viewport[23]?.includes("BOTTOM"),
        `Expected BOTTOM on last row, got: ${viewport[23]}`,
      );
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("maxHeight", () => {
    it("should truncate overlay to maxHeight", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["Line 1", "Line 2", "Line 3", "Line 4", "Line 5"]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { maxHeight: 3 });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      const content = viewport.join("\n");
      assert.ok(content.includes("Line 1"), "Should include Line 1");
      assert.ok(content.includes("Line 2"), "Should include Line 2");
      assert.ok(content.includes("Line 3"), "Should include Line 3");
      assert.ok(!content.includes("Line 4"), "Should NOT include Line 4");
      assert.ok(!content.includes("Line 5"), "Should NOT include Line 5");
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("maxHeight", () => {
    it("should truncate overlay to maxHeightPercent", async () => {
      const terminal = new VirtualTerminal(80, 10);
      const tui: TUI = new TuiMainScreen(terminal);
      // 10 lines in a 10 row terminal with 50% maxHeight should show 5 lines
      const overlay = new StaticOverlay([
        "L1",
        "L2",
        "L3",
        "L4",
        "L5",
        "L6",
        "L7",
        "L8",
        "L9",
        "L10",
      ]);

      tui.addChild(new EmptyContent());
      tui.showOverlay(overlay, { maxHeight: "50%" });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      const content = viewport.join("\n");
      assert.ok(content.includes("L1"), "Should include L1");
      assert.ok(content.includes("L5"), "Should include L5");
      assert.ok(!content.includes("L6"), "Should NOT include L6");
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("absolute positioning", () => {
    it("row and col should override anchor", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      const overlay = new StaticOverlay(["ABSOLUTE"]);

      tui.addChild(new EmptyContent());
      // Even with bottom-right anchor, row/col should win
      tui.showOverlay(overlay, { anchor: "bottom-right", row: 3, col: 5, width: 10 });
      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      assert.ok(
        viewport[3]?.includes("ABSOLUTE"),
        `Expected ABSOLUTE on row 3, got: ${viewport[3]}`,
      );
      const colIndex = viewport[3]?.indexOf("ABSOLUTE") ?? -1;
      assert.strictEqual(colIndex, 5, `Expected col 5, got ${colIndex}`);
      tui.stop();
    });
  });
});
