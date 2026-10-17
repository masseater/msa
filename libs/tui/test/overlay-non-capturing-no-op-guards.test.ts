import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { FocusableOverlay } from "./overlay-non-capturing-focusable-overlay.ts";
import { renderAndFlush, withOverlayTui } from "./overlay-non-capturing-helpers.ts";

describe("TUI overlay non-capturing", () => {
  describe("no-op guards", () => {
    it("focus() on hidden overlay is a no-op", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
            Effect.gen(function* () {
              const handle = tui.showOverlay(overlay, { nonCapturing: true });
              handle.setHidden(true);
              handle.focus();
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(editor.focused, true);
              assert.strictEqual(handle.isFocused(), false);
            }),
          );
        }),
      ));

    it("focus() after hide() is a no-op", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
            Effect.gen(function* () {
              const handle = tui.showOverlay(overlay, { nonCapturing: true });
              handle.hide();
              handle.focus();
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(editor.focused, true);
              assert.strictEqual(handle.isFocused(), false);
            }),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("no-op guards", () => {
    it("unfocus() when overlay does not have focus is a no-op", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new FocusableOverlay(["EDITOR"]);
          const overlay = new FocusableOverlay(["OVERLAY"]);
          yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
            Effect.gen(function* () {
              const handle = tui.showOverlay(overlay, { nonCapturing: true });
              handle.unfocus();
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(editor.focused, true);
              assert.strictEqual(overlay.focused, false);
            }),
          );
        }),
      ));

    it("unfocus() with null preFocus clears focus and does not route input back to overlay", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const overlay = new FocusableOverlay(["OVERLAY"]);
          yield* withOverlayTui({}, ({ tui, terminal }) =>
            Effect.gen(function* () {
              const handle = tui.showOverlay(overlay);
              assert.strictEqual(overlay.focused, true);
              handle.unfocus();
              assert.strictEqual(overlay.focused, false);
              terminal.sendInput("x");
              yield* renderAndFlush(tui, terminal);
              assert.deepStrictEqual(overlay.inputs, []);
              assert.strictEqual(handle.isFocused(), false);
            }),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus cycle prevention", () => {
    it("toggle focus between non-capturing overlays then unfocus returns to editor", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new FocusableOverlay(["EDITOR"]);
          const a = new FocusableOverlay(["A"]);
          const b = new FocusableOverlay(["B"]);
          yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
            Effect.gen(function* () {
              const aHandle = tui.showOverlay(a, { nonCapturing: true });
              const bHandle = tui.showOverlay(b, { nonCapturing: true });
              aHandle.focus();
              bHandle.focus();
              aHandle.focus();
              aHandle.unfocus();
              yield* renderAndFlush(tui, terminal);
              assert.strictEqual(editor.focused, true);
              assert.strictEqual(a.focused, false);
              assert.strictEqual(b.focused, false);
            }),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus cycle prevention", () => {
    focusCyclePreventionCases4();
  });
});

function focusCyclePreventionCases4(): void {
  it("explicit unfocus target supports cycling between three overlays and editor", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const a = new FocusableOverlay(["A"]);
        const b = new FocusableOverlay(["B"]);
        const c = new FocusableOverlay(["C"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            const aHandle = tui.showOverlay(a);
            const bHandle = tui.showOverlay(b);
            const cHandle = tui.showOverlay(c);

            aHandle.focus();
            terminal.sendInput("a");
            yield* renderAndFlush(tui, terminal);
            bHandle.focus();
            terminal.sendInput("b");
            yield* renderAndFlush(tui, terminal);
            cHandle.focus();
            terminal.sendInput("c");
            yield* renderAndFlush(tui, terminal);
            cHandle.unfocus({ target: editor });
            terminal.sendInput("e");
            yield* renderAndFlush(tui, terminal);
            aHandle.focus();
            terminal.sendInput("A");
            yield* renderAndFlush(tui, terminal);
            aHandle.unfocus({ target: editor });
            terminal.sendInput("E");
            yield* renderAndFlush(tui, terminal);

            assert.deepStrictEqual(a.inputs, ["a", "A"]);
            assert.deepStrictEqual(b.inputs, ["b"]);
            assert.deepStrictEqual(c.inputs, ["c"]);
            assert.deepStrictEqual(editor.inputs, ["e", "E"]);
            assert.strictEqual(editor.focused, true);
          }),
        );
      }),
    ));
}

describe("TUI overlay non-capturing", () => {
  describe("focus cycle prevention", () => {
    it("explicit null unfocus target clears focus without restoring overlays", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const overlay = new FocusableOverlay(["OVERLAY"]);
          yield* withOverlayTui({}, ({ tui, terminal }) =>
            Effect.gen(function* () {
              const handle = tui.showOverlay(overlay);
              handle.unfocus({ target: null });
              terminal.sendInput("x");
              yield* renderAndFlush(tui, terminal);
              assert.deepStrictEqual(overlay.inputs, []);
              assert.strictEqual(handle.isFocused(), false);
            }),
          );
        }),
      ));
  });
});

describe("TUI overlay non-capturing", () => {
  describe("focus cycle prevention", () => {
    it("hiding focused overlay falls back to next visual-frontmost overlay", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new FocusableOverlay(["EDITOR"]);
          const a = new FocusableOverlay(["A"]);
          const b = new FocusableOverlay(["B"]);
          const c = new FocusableOverlay(["C"]);
          yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
            Effect.gen(function* () {
              const aHandle = tui.showOverlay(a);
              const bHandle = tui.showOverlay(b);
              tui.showOverlay(c);
              aHandle.focus();
              bHandle.focus();
              bHandle.setHidden(true);
              terminal.sendInput("x");
              yield* renderAndFlush(tui, terminal);
              assert.deepStrictEqual(a.inputs, ["x"]);
              assert.deepStrictEqual(c.inputs, []);
              assert.strictEqual(a.focused, true);
            }),
          );
        }),
      ));
  });
});
