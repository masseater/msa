import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import CursorTrackingTerminal from "./overlay-options-cursor-tracking-terminal.ts";
import EmptyContent from "./overlay-options-empty-content.ts";
import renderAndFlush from "./overlay-options-helpers.ts";
import StaticOverlay from "./overlay-options-static-overlay.ts";
import virtualTerminal from "./virtual-terminal.ts";

const { VirtualTerminal } = virtualTerminal;

describe("TUI overlay options", () => {
  describe("stacked overlays", () => {
    it("should render multiple overlays with later ones on top", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);

          tui.addChild(new EmptyContent());

          const overlay1 = new StaticOverlay(["FIRST-OVERLAY"]);
          tui.showOverlay(overlay1, { anchor: "top-left", width: 20 });

          const overlay2 = new StaticOverlay(["SECOND"]);
          tui.showOverlay(overlay2, { anchor: "top-left", width: 10 });

          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          assert.ok(
            viewport[0]?.includes("SECOND"),
            `Expected SECOND on row 0, got: ${viewport[0]}`,
          );
          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("stacked overlays", () => {
    it("should handle overlays at different positions without interference", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);

          tui.addChild(new EmptyContent());

          const overlay1 = new StaticOverlay(["TOP-LEFT"]);
          tui.showOverlay(overlay1, { anchor: "top-left", width: 15 });

          const overlay2 = new StaticOverlay(["BTM-RIGHT"]);
          tui.showOverlay(overlay2, { anchor: "bottom-right", width: 15 });

          tui.start();
          yield* renderAndFlush(tui, terminal);

          const viewport = terminal.getViewport();
          assert.ok(
            viewport[0]?.includes("TOP-LEFT"),
            `Expected TOP-LEFT on row 0, got: ${viewport[0]}`,
          );
          assert.ok(
            viewport[23]?.includes("BTM-RIGHT"),
            `Expected BTM-RIGHT on row 23, got: ${viewport[23]}`,
          );
          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("stacked overlays", () => {
    it("should properly hide overlays in stack order", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);

          tui.addChild(new EmptyContent());

          const overlay1 = new StaticOverlay(["FIRST"]);
          tui.showOverlay(overlay1, { anchor: "top-left", width: 10 });

          const overlay2 = new StaticOverlay(["SECOND"]);
          tui.showOverlay(overlay2, { anchor: "top-left", width: 10 });

          tui.start();
          yield* renderAndFlush(tui, terminal);

          let viewport = terminal.getViewport();
          assert.ok(viewport[0]?.includes("SECOND"), "SECOND should be visible initially");

          tui.hideOverlay();
          yield* renderAndFlush(tui, terminal);

          viewport = terminal.getViewport();
          assert.ok(viewport[0]?.includes("FIRST"), "FIRST should be visible after hiding SECOND");

          tui.stop();
        }),
      ));
  });
});

describe("TUI overlay options", () => {
  describe("hiding after stop", () => {
    it("hideOverlay() leaves the cursor visible", () => {
      const terminal = new CursorTrackingTerminal(80, 24);
      const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);
      tui.start();
      tui.showOverlay(new StaticOverlay(["OVERLAY"]), { nonCapturing: true });

      tui.stop();
      tui.hideOverlay();

      assert.strictEqual(terminal.cursorVisible, true);
    });

    it("overlay handle hide() leaves the cursor visible", () => {
      const terminal = new CursorTrackingTerminal(80, 24);
      const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);
      tui.start();
      const handle = tui.showOverlay(new StaticOverlay(["OVERLAY"]), { nonCapturing: true });

      tui.stop();
      handle.hide();

      assert.strictEqual(terminal.cursorVisible, true);
    });
  });
});
