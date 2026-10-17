import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { EmptyContent } from "./overlay-non-capturing-empty-content.ts";
import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush } from "./overlay-non-capturing-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("non-capturing overlay preserves focus on creation", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            tui.showOverlay(overlay, { nonCapturing: true });
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
            assert.strictEqual(overlay.focused, false);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));

    it("focus() transfers focus to the overlay", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const handle = tui.showOverlay(overlay, { nonCapturing: true });
            handle.focus();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, false);
            assert.strictEqual(overlay.focused, true);
            assert.strictEqual(handle.isFocused(), true);
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
  describe("focus management", () => {
    it("unfocus() restores previous focus", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const handle = tui.showOverlay(overlay, { nonCapturing: true });
            handle.focus();
            handle.unfocus();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
            assert.strictEqual(overlay.focused, false);
            assert.strictEqual(handle.isFocused(), false);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));

    it("setHidden(false) on non-capturing overlay does not auto-focus", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const handle = tui.showOverlay(overlay, { nonCapturing: true });
            handle.setHidden(true);
            handle.setHidden(false);
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
            assert.strictEqual(overlay.focused, false);
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
  describe("focus management", () => {
    it("hide() when overlay is not focused does not change focus", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const handle = tui.showOverlay(overlay, { nonCapturing: true });
            handle.hide();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                tui.stop();
              }),
            ),
          );
        }),
      ));

    it("hide() when focused restores focus correctly", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const handle = tui.showOverlay(overlay, { nonCapturing: true });
            handle.focus();
            handle.hide();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
            assert.strictEqual(overlay.focused, false);
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
  describe("focus management", () => {
    it("capturing overlay removed with non-capturing below restores focus to editor", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const nonCapturing = new FocusableOverlay(["NC"]);
          const capturing = new FocusableOverlay(["CAP"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            tui.showOverlay(nonCapturing, { nonCapturing: true });
            const handle = tui.showOverlay(capturing);
            assert.strictEqual(capturing.focused, true);
            handle.hide();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
            assert.strictEqual(nonCapturing.focused, false);
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
  describe("focus management", () => {
    it("sub-overlay cleanup then hideOverlay restores focus and input to editor", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const timer = new FocusableOverlay(["TIMER"]);
          const controller = new FocusableOverlay(["CTRL"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const timerHandle = tui.showOverlay(timer, { nonCapturing: true });
            tui.showOverlay(controller);
            assert.strictEqual(controller.focused, true);
            assert.strictEqual(editor.focused, false);
            timerHandle.hide();
            tui.hideOverlay();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
            assert.strictEqual(controller.focused, false);
            assert.strictEqual(timer.focused, false);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(editor.inputs, ["x"]);
            assert.deepStrictEqual(controller.inputs, []);
            assert.deepStrictEqual(timer.inputs, []);
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
  describe("focus management", () => {
    it("removed focused child overlay does not become parent overlay fallback", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const child = new FocusableOverlay(["CHILD"]);
          const parent = new FocusableOverlay(["PARENT"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const childHandle = tui.showOverlay(child, { nonCapturing: true });
            childHandle.focus();
            const parentHandle = tui.showOverlay(parent);
            assert.strictEqual(parent.focused, true);

            childHandle.hide();
            parentHandle.hide();
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);

            assert.deepStrictEqual(editor.inputs, ["x"]);
            assert.deepStrictEqual(child.inputs, []);
            assert.deepStrictEqual(parent.inputs, []);
            assert.strictEqual(editor.focused, true);
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
