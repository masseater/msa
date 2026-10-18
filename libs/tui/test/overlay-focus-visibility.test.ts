import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect, Deferred } from "effect";

import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush, withOverlayTui } from "./overlay-non-capturing-helpers.ts";

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    temporarilyInvisibleFocusedOverlayFalls();
    temporarilyInvisibleFocusedOverlayNull();
    cyclicOverlayPreFocusAncestryDoes();
    hideoverlayDoesNotReassignFocus();
    multipleCapturingNonCapturingOverlays();
    capturingOverlayUnfocusTopmostCapturing();
    microtaskDeferredSubOverlayPattern();
  });
});

function temporarilyInvisibleFocusedOverlayFalls(): void {
  it("temporarily invisible focused overlay falls back without losing restore eligibility", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        let visible = true;
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
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
          }),
        );
      }),
    ));
}

function temporarilyInvisibleFocusedOverlayNull(): void {
  it("temporarily invisible focused overlay with null preFocus restores when visible again", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const overlay = new FocusableOverlay(["OVERLAY"]);
        let visible = true;
        yield* withOverlayTui({}, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(overlay, { visible: () => visible });
            visible = false;
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(overlay.inputs, []);
            visible = true;
            terminal.sendInput("y");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(overlay.inputs, ["y"]);
          }),
        );
      }),
    ));
}

function cyclicOverlayPreFocusAncestryDoes(): void {
  it("cyclic overlay preFocus ancestry does not hang focus changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        yield* withOverlayTui({ focus: overlay }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            const handle = tui.showOverlay(overlay, { nonCapturing: true });
            handle.focus();
            tui.setFocus(editor);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(editor.inputs, ["x"]);
            assert.deepStrictEqual(overlay.inputs, []);
          }),
        );
      }),
    ));
}

function hideoverlayDoesNotReassignFocus(): void {
  it("hideOverlay() does not reassign focus when topmost overlay is non-capturing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const capturing = new FocusableOverlay(["CAP"]);
        const nonCapturing = new FocusableOverlay(["NC"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(capturing);
            tui.showOverlay(nonCapturing, { nonCapturing: true });
            assert.strictEqual(capturing.focused, true);
            tui.hideOverlay();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(capturing.focused, true);
          }),
        );
      }),
    ));
}

function multipleCapturingNonCapturingOverlays(): void {
  it("multiple capturing and non-capturing overlays restore focus through removals", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const c1 = new FocusableOverlay(["C1"]);
        const n1 = new FocusableOverlay(["N1"]);
        const c2 = new FocusableOverlay(["C2"]);
        const n2 = new FocusableOverlay(["N2"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
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
          }),
        );
      }),
    ));
}

function capturingOverlayUnfocusTopmostCapturing(): void {
  it("capturing overlay unfocus() on topmost capturing overlay falls back to preFocus", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const capturing = new FocusableOverlay(["CAP"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            const handle = tui.showOverlay(capturing);
            assert.strictEqual(capturing.focused, true);
            handle.unfocus();
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(editor.focused, true);
            assert.strictEqual(capturing.focused, false);
          }),
        );
      }),
    ));
}

function microtaskDeferredSubOverlayPattern(): void {
  it("microtask-deferred sub-overlay pattern (showExtensionCustom simulation) restores focus", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const timer = new FocusableOverlay(["TIMER"]);
        const controller = new FocusableOverlay(["CTRL"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            let timerHandle: ReturnType<typeof tui.showOverlay> | null = null;
            let doneFn: () => void = () => {
              throw new Error("doneFn was not initialized");
            };

            const overlayDone = Deferred.makeUnsafe<void>();
            doneFn = () => {
              if (timerHandle === null) throw new Error("timerHandle was not initialized");
              timerHandle.hide();
              tui.hideOverlay();
              Deferred.doneUnsafe(overlayDone, Effect.void);
            };
            timerHandle = tui.showOverlay(timer, { nonCapturing: true });
            Promise.resolve(controller).then((c) => tui.showOverlay(c));

            yield* Effect.promise(() => Promise.resolve());
            yield* renderAndFlush(tui, terminal);

            assert.strictEqual(controller.focused, true);
            assert.strictEqual(editor.focused, false);

            doneFn();
            yield* Deferred.await(overlayDone);
            yield* renderAndFlush(tui, terminal);

            assert.strictEqual(editor.focused, true, "editor should regain focus");
            assert.strictEqual(controller.focused, false);
            assert.strictEqual(timer.focused, false);

            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(editor.inputs, ["x"], "editor should receive input after close");
            assert.deepStrictEqual(controller.inputs, []);
          }),
        );
      }),
    ));
}
