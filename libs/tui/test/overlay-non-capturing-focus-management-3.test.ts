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
    it("blocked replacement setFocus(null) resumes the visible overlay", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const replacement = new FocusableOverlay(["REPLACEMENT"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          replacement.handleInput = (data: string) => {
            replacement.inputs.push(data);
            if (data === "\r") tui.setFocus(null);
          };
          overlay.handleInput = (data: string) => {
            overlay.inputs.push(data);
            if (data === "b") tui.setFocus(replacement);
          };
          tui.addChild(new EmptyContent());
          tui.start();
          yield* Effect.gen(function* () {
            tui.showOverlay(overlay);
            terminal.sendInput("b");
            yield* renderAndFlush(tui, terminal);
            terminal.sendInput("\r");
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(replacement.inputs, ["\r"]);
            assert.deepStrictEqual(overlay.inputs, ["b", "x"]);
            assert.strictEqual(overlay.focused, true);
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
    it("temporarily invisible focused overlay falls back without losing restore eligibility", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          let visible = true;
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            tui.showOverlay(overlay, { visible: () => visible });
            tui.setFocus(editor);
            visible = false;
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(editor.inputs, ["x"]);
            assert.deepStrictEqual(overlay.inputs, []);
            visible = true;
            terminal.sendInput("y");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(editor.inputs, ["x"]);
            assert.deepStrictEqual(overlay.inputs, ["y"]);
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
    it("temporarily invisible focused overlay with null preFocus restores when visible again", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          let visible = true;
          tui.addChild(new EmptyContent());
          tui.start();
          yield* Effect.gen(function* () {
            tui.showOverlay(overlay, { visible: () => visible });
            visible = false;
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(overlay.inputs, []);
            visible = true;
            terminal.sendInput("y");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(overlay.inputs, ["y"]);
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
    it("cyclic overlay preFocus ancestry does not hang focus changes", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(overlay);
          tui.start();
          yield* Effect.gen(function* () {
            const handle = tui.showOverlay(overlay, { nonCapturing: true });
            handle.focus();
            tui.setFocus(editor);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(editor.inputs, ["x"]);
            assert.deepStrictEqual(overlay.inputs, []);
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
    it("handleInput restores the focus-order top overlay after base focus steal", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const lower = new FocusableOverlay(["LOWER"]);
          const upper = new FocusableOverlay(["UPPER"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const lowerHandle = tui.showOverlay(lower);
            tui.showOverlay(upper);
            lowerHandle.focus();
            tui.setFocus(editor);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(lower.inputs, ["x"]);
            assert.deepStrictEqual(upper.inputs, []);
            assert.deepStrictEqual(editor.inputs, []);
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
    it("hideOverlay() does not reassign focus when topmost overlay is non-capturing", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const capturing = new FocusableOverlay(["CAP"]);
          const nonCapturing = new FocusableOverlay(["NC"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            tui.showOverlay(capturing);
            tui.showOverlay(nonCapturing, { nonCapturing: true });
            assert.strictEqual(capturing.focused, true);
            tui.hideOverlay();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(capturing.focused, true);
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
    it("multiple capturing and non-capturing overlays restore focus through removals", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const c1 = new FocusableOverlay(["C1"]);
          const n1 = new FocusableOverlay(["N1"]);
          const c2 = new FocusableOverlay(["C2"]);
          const n2 = new FocusableOverlay(["N2"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const c1Handle = tui.showOverlay(c1);
            tui.showOverlay(n1, { nonCapturing: true });
            const c2Handle = tui.showOverlay(c2);
            tui.showOverlay(n2, { nonCapturing: true });
            assert.strictEqual(c2.focused, true);
            c2Handle.hide();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(c1.focused, true);
            c1Handle.hide();
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
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    it("capturing overlay unfocus() on topmost capturing overlay falls back to preFocus", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(80, 24);
          const tui: TUI = new TuiMainScreen(terminal);
          const editor = new FocusableOverlay(["EDITOR"]);
          const capturing = new FocusableOverlay(["CAP"]);
          tui.addChild(new EmptyContent());
          tui.setFocus(editor);
          tui.start();
          yield* Effect.gen(function* () {
            const handle = tui.showOverlay(capturing);
            assert.strictEqual(capturing.focused, true);
            handle.unfocus();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
            assert.strictEqual(capturing.focused, false);
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
