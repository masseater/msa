import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { EmptyContent } from "./overlay-non-capturing-empty-content.ts";
import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush } from "./overlay-non-capturing-helpers.ts";
import { StaticOverlay } from "./overlay-non-capturing-static-overlay.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("focus() on already-focused overlay bumps visual order", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(20, 6);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
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
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("default rendering order for overlapping overlays follows creation order", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(20, 6);
          const tui: TUI = new TuiMainScreen(terminal);
          tui.addChild(new EmptyContent());
          tui.start();
          yield* Effect.gen(function* () {
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
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));

    it("focus() on lower overlay renders it on top", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(20, 6);
          const tui: TUI = new TuiMainScreen(terminal);
          tui.addChild(new EmptyContent());
          tui.start();
          yield* Effect.gen(function* () {
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
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("focusing middle overlay places it on top while preserving others relative order", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(20, 6);
          const tui: TUI = new TuiMainScreen(terminal);
          tui.addChild(new EmptyContent());
          tui.start();
          yield* Effect.gen(function* () {
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
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("capturing overlay hidden and shown again renders on top after unhide", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(20, 6);
          const tui: TUI = new TuiMainScreen(terminal);
          tui.addChild(new EmptyContent());
          tui.start();
          yield* Effect.gen(function* () {
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
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("rendering order", () => {
    it("unfocus() does not change visual order until another overlay is focused", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(20, 6);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
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
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));
  });
});
