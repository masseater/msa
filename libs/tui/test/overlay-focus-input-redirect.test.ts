import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Container } from "../src/tui-component.ts";
import FocusableOverlay from "./overlay-non-capturing-focusable-overlay.ts";
import overlayNonCapturingHelpers from "./overlay-non-capturing-helpers.ts";

const { renderAndFlush, withOverlayTui } = overlayNonCapturingHelpers;

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    handleinputRestoresFocusVisibleFocused();
    handleinputRestoresFocusExplicitlyFocused();
    passiveNonCapturingOverlayDoes();
    unfocusPreventsVisibleOverlayFrom();
    handleinputRestoresFocusOrderTop();
    handleinputRedirectionSkipsNonCapturing();
    blockedReplacementCanMoveFocus();
  });
});

function handleinputRestoresFocusVisibleFocused(): void {
  it("handleInput restores focus to a visible focused overlay after base focus steal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const replacement = new FocusableOverlay(["REPLACEMENT"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(overlay);
            assert.strictEqual(overlay.focused, true);
            tui.setFocus(replacement);
            tui.setFocus(editor);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(overlay.inputs, ["x"]);
            assert.deepStrictEqual(editor.inputs, []);
            assert.strictEqual(overlay.focused, true);
          }),
        );
      }),
    ));
}

function handleinputRestoresFocusExplicitlyFocused(): void {
  it("handleInput restores focus to explicitly focused raw sub-overlay after base focus steal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const controller = new FocusableOverlay(["CONTROLLER"]);
        const subOverlay = new FocusableOverlay(["SUB"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(controller);
            const subHandle = tui.showOverlay(subOverlay, { nonCapturing: true });
            subHandle.focus();
            tui.setFocus(editor);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(subOverlay.inputs, ["x"]);
            assert.deepStrictEqual(controller.inputs, []);
            assert.deepStrictEqual(editor.inputs, []);
          }),
        );
      }),
    ));
}

function passiveNonCapturingOverlayDoes(): void {
  it("passive non-capturing overlay does not regain input after base focus", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const passive = new FocusableOverlay(["PASSIVE"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(passive, { nonCapturing: true });
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(editor.inputs, ["x"]);
            assert.deepStrictEqual(passive.inputs, []);
            assert.strictEqual(editor.focused, true);
          }),
        );
      }),
    ));
  it("explicitly focused non-capturing overlay regains input after base focus steal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const overlay = new FocusableOverlay(["NC"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            const handle = tui.showOverlay(overlay, { nonCapturing: true });
            handle.focus();
            tui.setFocus(editor);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(overlay.inputs, ["x"]);
            assert.deepStrictEqual(editor.inputs, []);
          }),
        );
      }),
    ));
}

function unfocusPreventsVisibleOverlayFrom(): void {
  it("unfocus() prevents visible overlay from regaining input", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            const handle = tui.showOverlay(overlay);
            handle.unfocus();
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(editor.inputs, ["x"]);
            assert.deepStrictEqual(overlay.inputs, []);
            assert.strictEqual(editor.focused, true);
          }),
        );
      }),
    ));
  it("setFocus(null) explicitly clears visible overlay restore", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const overlay = new FocusableOverlay(["OVERLAY"]);
        yield* withOverlayTui({}, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(overlay);
            tui.setFocus(null);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(overlay.inputs, []);
            assert.strictEqual(overlay.focused, false);
          }),
        );
      }),
    ));
}

function handleinputRestoresFocusOrderTop(): void {
  it("handleInput restores the focus-order top overlay after base focus steal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const lower = new FocusableOverlay(["LOWER"]);
        const upper = new FocusableOverlay(["UPPER"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            const lowerHandle = tui.showOverlay(lower);
            tui.showOverlay(upper);
            lowerHandle.focus();
            tui.setFocus(editor);
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(lower.inputs, ["x"]);
            assert.deepStrictEqual(upper.inputs, []);
            assert.deepStrictEqual(editor.inputs, []);
          }),
        );
      }),
    ));
}

function handleinputRedirectionSkipsNonCapturing(): void {
  it("handleInput redirection skips non-capturing overlays when focused overlay becomes invisible", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const fallbackCapturing = new FocusableOverlay(["FALLBACK"]);
        const nonCapturing = new FocusableOverlay(["NC"]);
        const primary = new FocusableOverlay(["PRIMARY"]);
        let isVisible = true;
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            tui.showOverlay(fallbackCapturing);
            tui.showOverlay(nonCapturing, { nonCapturing: true });
            tui.showOverlay(primary, { visible: () => isVisible });
            assert.strictEqual(primary.focused, true);
            isVisible = false;
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(primary.inputs, []);
            assert.deepStrictEqual(nonCapturing.inputs, []);
            assert.deepStrictEqual(fallbackCapturing.inputs, ["x"]);
            assert.strictEqual(fallbackCapturing.focused, true);
          }),
        );
      }),
    ));
}

function blockedReplacementCanMoveFocus(): void {
  it("blocked replacement can move focus internally before overlay restore", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const base = new Container();
        const editor = new FocusableOverlay(["EDITOR"]);
        const firstReplacement = new FocusableOverlay(["FIRST"]);
        const secondReplacement = new FocusableOverlay(["SECOND"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        base.addChild(editor);
        base.addChild(firstReplacement);
        base.addChild(secondReplacement);
        yield* withOverlayTui({ focus: editor, root: base }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            overlay.handleInput = (data: string) => {
              overlay.inputs.push(data);
              if (data === "b") tui.setFocus(firstReplacement);
            };
            firstReplacement.handleInput = (data: string) => {
              firstReplacement.inputs.push(data);
              if (data === "n") tui.setFocus(secondReplacement);
            };
            secondReplacement.handleInput = (data: string) => {
              secondReplacement.inputs.push(data);
              if (data === "\r") {
                base.clear();
                base.addChild(editor);
                tui.setFocus(editor);
              }
            };
            tui.showOverlay(overlay);
            terminal.sendInput("b");
            yield* renderAndFlush(tui, terminal);
            terminal.sendInput("n");
            yield* renderAndFlush(tui, terminal);
            terminal.sendInput("2");
            terminal.sendInput("\r");
            yield* renderAndFlush(tui, terminal);

            assert.deepStrictEqual(overlay.inputs, ["b"]);
            assert.deepStrictEqual(firstReplacement.inputs, ["n"]);
            assert.deepStrictEqual(secondReplacement.inputs, ["2", "\r"]);
            assert.strictEqual(overlay.focused, true);
          }),
        );
      }),
    ));
}
