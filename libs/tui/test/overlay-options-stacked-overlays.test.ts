import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import type { TUI } from "../src/tui.ts";
import { CursorTrackingTerminal } from "./overlay-options-cursor-tracking-terminal.ts";
import { EmptyContent } from "./overlay-options-empty-content.ts";
import { renderAndFlush } from "./overlay-options-helpers.ts";
import { StaticOverlay } from "./overlay-options-static-overlay.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay options", () => {
  describe("stacked overlays", () => {
    it("should render multiple overlays with later ones on top", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);

      tui.addChild(new EmptyContent());

      // First overlay at top-left
      const overlay1 = new StaticOverlay(["FIRST-OVERLAY"]);
      tui.showOverlay(overlay1, { anchor: "top-left", width: 20 });

      // Second overlay at top-left (should cover part of first)
      const overlay2 = new StaticOverlay(["SECOND"]);
      tui.showOverlay(overlay2, { anchor: "top-left", width: 10 });

      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      // Second overlay should be visible (on top)
      assert.ok(viewport[0]?.includes("SECOND"), `Expected SECOND on row 0, got: ${viewport[0]}`);
      // Part of first overlay might still be visible after SECOND
      // FIRST-OVERLAY is 13 chars, SECOND is 6 chars, so "OVERLAY" part might show
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("stacked overlays", () => {
    it("should handle overlays at different positions without interference", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);

      tui.addChild(new EmptyContent());

      // Overlay at top-left
      const overlay1 = new StaticOverlay(["TOP-LEFT"]);
      tui.showOverlay(overlay1, { anchor: "top-left", width: 15 });

      // Overlay at bottom-right
      const overlay2 = new StaticOverlay(["BTM-RIGHT"]);
      tui.showOverlay(overlay2, { anchor: "bottom-right", width: 15 });

      tui.start();
      await renderAndFlush(tui, terminal);

      const viewport = terminal.getViewport();
      // Both should be visible
      assert.ok(
        viewport[0]?.includes("TOP-LEFT"),
        `Expected TOP-LEFT on row 0, got: ${viewport[0]}`,
      );
      assert.ok(
        viewport[23]?.includes("BTM-RIGHT"),
        `Expected BTM-RIGHT on row 23, got: ${viewport[23]}`,
      );
      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("stacked overlays", () => {
    it("should properly hide overlays in stack order", async () => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);

      tui.addChild(new EmptyContent());

      // Show two overlays
      const overlay1 = new StaticOverlay(["FIRST"]);
      tui.showOverlay(overlay1, { anchor: "top-left", width: 10 });

      const overlay2 = new StaticOverlay(["SECOND"]);
      tui.showOverlay(overlay2, { anchor: "top-left", width: 10 });

      tui.start();
      await renderAndFlush(tui, terminal);

      // Second should be visible
      let viewport = terminal.getViewport();
      assert.ok(viewport[0]?.includes("SECOND"), "SECOND should be visible initially");

      // Hide top overlay
      tui.hideOverlay();
      await renderAndFlush(tui, terminal);

      // First should now be visible
      viewport = terminal.getViewport();
      assert.ok(viewport[0]?.includes("FIRST"), "FIRST should be visible after hiding SECOND");

      tui.stop();
    });
  });
});

describe("TUI overlay options", () => {
  describe("hiding after stop", () => {
    it("hideOverlay() leaves the cursor visible", () => {
      const terminal = new CursorTrackingTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      tui.start();
      tui.showOverlay(new StaticOverlay(["OVERLAY"]), { nonCapturing: true });

      tui.stop();
      tui.hideOverlay();

      assert.strictEqual(terminal.cursorVisible, true);
    });

    it("overlay handle hide() leaves the cursor visible", () => {
      const terminal = new CursorTrackingTerminal(80, 24);
      const tui: TUI = new TuiMainScreen(terminal);
      tui.start();
      const handle = tui.showOverlay(new StaticOverlay(["OVERLAY"]), { nonCapturing: true });

      tui.stop();
      handle.hide();

      assert.strictEqual(terminal.cursorVisible, true);
    });
  });
});
