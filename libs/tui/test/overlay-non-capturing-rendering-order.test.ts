import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush, withOverlayTui } from "./overlay-non-capturing-helpers.ts";
import { StaticOverlay } from "./overlay-non-capturing-static-overlay.ts";

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("focus() on already-focused overlay bumps visual order", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new FocusableOverlay(["EDITOR"]);
          yield* withOverlayTui({ focus: editor, width: 20, height: 6 }, ({ tui, terminal }) =>
            Effect.gen(function* () {
              const aHandle = tui.showOverlay(new StaticOverlay(["A"]), {
                row: 0,
                col: 0,
                width: 1,
                nonCapturing: true,
              });
              tui.showOverlay(new StaticOverlay(["B"]), {
                row: 0,
                col: 0,
                width: 1,
                nonCapturing: true,
              });
              aHandle.focus();
              tui.showOverlay(new StaticOverlay(["C"]), {
                row: 0,
                col: 0,
                width: 1,
                nonCapturing: true,
              });
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "C");
              aHandle.focus();
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
              assert.strictEqual(aHandle.isFocused(), true);
            }),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("default rendering order for overlapping overlays follows creation order", () =>
      Effect.runPromise(
        withOverlayTui({ width: 20, height: 6 }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(new StaticOverlay(["A"]), {
              row: 0,
              col: 0,
              width: 1,
              nonCapturing: true,
            });
            tui.showOverlay(new StaticOverlay(["B"]), {
              row: 0,
              col: 0,
              width: 1,
              nonCapturing: true,
            });
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
          }),
        ),
      ));

    it("focus() on lower overlay renders it on top", () =>
      Effect.runPromise(
        withOverlayTui({ width: 20, height: 6 }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            const lower = tui.showOverlay(new StaticOverlay(["A"]), {
              row: 0,
              col: 0,
              width: 1,
              nonCapturing: true,
            });
            tui.showOverlay(new StaticOverlay(["B"]), {
              row: 0,
              col: 0,
              width: 1,
              nonCapturing: true,
            });
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
            lower.focus();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
          }),
        ),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("focusing middle overlay places it on top while preserving others relative order", () =>
      Effect.runPromise(
        withOverlayTui({ width: 20, height: 6 }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(new StaticOverlay(["A"]), {
              row: 0,
              col: 0,
              width: 1,
              nonCapturing: true,
            });
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
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "C");
            middle.focus();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
            middle.hide();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "C");
            top.hide();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
          }),
        ),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("capturing overlay hidden and shown again renders on top after unhide", () =>
      Effect.runPromise(
        withOverlayTui({ width: 20, height: 6 }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(new StaticOverlay(["A"]), {
              row: 0,
              col: 0,
              width: 1,
              nonCapturing: true,
            });
            const capturing = tui.showOverlay(new StaticOverlay(["B"]), {
              row: 0,
              col: 0,
              width: 1,
            });
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
            capturing.setHidden(true);
            tui.showOverlay(new StaticOverlay(["C"]), {
              row: 0,
              col: 0,
              width: 1,
              nonCapturing: true,
            });
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "C");
            capturing.setHidden(false);
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
          }),
        ),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("unfocus() does not change visual order until another overlay is focused", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new FocusableOverlay(["EDITOR"]);
          yield* withOverlayTui({ focus: editor, width: 20, height: 6 }, ({ tui, terminal }) =>
            Effect.gen(function* () {
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
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
              a.focus();
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
              a.unfocus();
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "A");
              b.focus();
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(terminal.getViewport()[0]?.charAt(0), "B");
            }),
          );
        }),
      ));
  });
});
