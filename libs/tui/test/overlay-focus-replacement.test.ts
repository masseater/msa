import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Container } from "../src/tui-component.ts";
import FocusableOverlay from "./overlay-non-capturing-focusable-overlay.ts";
import overlayNonCapturingHelpers from "./overlay-non-capturing-helpers.ts";

const { renderAndFlush, withOverlayTui } = overlayNonCapturingHelpers;

describe("TUI overlay non-capturing", () => {
  describe("focus management", () => {
    removedReplacementRestoresOverlayEven();
    unfocusTargetReleasesBlockedOverlay();
    blockedReplacementSetFocusNullResumes();
    activeBaseFocusReplacementReceives();
    activeReplacementStillReceivesInput();
  });
});

function removedReplacementRestoresOverlayEven(): void {
  it("removed replacement restores overlay even when overlay preFocus differs from next focus", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const base = new Container();
        const editor = new FocusableOverlay(["EDITOR"]);
        const palette = new FocusableOverlay(["PALETTE"]);
        const replacement = new FocusableOverlay(["REPLACEMENT"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        base.addChild(editor);
        base.addChild(palette);
        base.addChild(replacement);
        yield* withOverlayTui({ focus: palette, root: base }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            overlay.handleInput = (data: string) => {
              overlay.inputs.push(data);
              if (data === "b") tui.setFocus(replacement);
            };
            replacement.handleInput = (data: string) => {
              replacement.inputs.push(data);
              if (data === "\r") {
                base.clear();
                base.addChild(editor);
                tui.setFocus(editor);
              }
            };
            tui.showOverlay(overlay);
            terminal.sendInput("b");
            yield* renderAndFlush(tui, terminal);
            terminal.sendInput("\r");
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);

            assert.deepStrictEqual(overlay.inputs, ["b", "x"]);
            assert.deepStrictEqual(replacement.inputs, ["\r"]);
            assert.deepStrictEqual(editor.inputs, []);
            assert.strictEqual(overlay.focused, true);
          }),
        );
      }),
    ));
}

function unfocusTargetReleasesBlockedOverlay(): void {
  it("unfocus target releases a blocked overlay while replacement remains focused", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fallback = new FocusableOverlay(["FALLBACK"]);
        const target = new FocusableOverlay(["TARGET"]);
        const replacement = new FocusableOverlay(["REPLACEMENT"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        yield* withOverlayTui({}, ({ tui, terminal }) =>
          Effect.gen(function* () {
            replacement.handleInput = (data: string) => {
              replacement.inputs.push(data);
              if (data === "\r") tui.setFocus(fallback);
            };
            const overlayHandle = tui.showOverlay(overlay);
            overlay.handleInput = (data: string) => {
              overlay.inputs.push(data);
              if (data === "b") {
                tui.setFocus(replacement);
                overlayHandle.unfocus({ target });
              }
            };

            terminal.sendInput("b");
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(replacement.focused, true);
            terminal.sendInput("\r");
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);

            assert.deepStrictEqual(overlay.inputs, ["b"]);
            assert.deepStrictEqual(replacement.inputs, ["\r"]);
            assert.deepStrictEqual(fallback.inputs, []);
            assert.deepStrictEqual(target.inputs, ["x"]);
          }),
        );
      }),
    ));
}

function blockedReplacementSetFocusNullResumes(): void {
  it("blocked replacement setFocus(null) resumes the visible overlay", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const replacement = new FocusableOverlay(["REPLACEMENT"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        yield* withOverlayTui({}, ({ tui, terminal }) =>
          Effect.gen(function* () {
            replacement.handleInput = (data: string) => {
              replacement.inputs.push(data);
              if (data === "\r") tui.setFocus(null);
            };
            overlay.handleInput = (data: string) => {
              overlay.inputs.push(data);
              if (data === "b") tui.setFocus(replacement);
            };
            tui.showOverlay(overlay);
            terminal.sendInput("b");
            yield* renderAndFlush(tui, terminal);
            terminal.sendInput("\r");
            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(replacement.inputs, ["\r"]);
            assert.deepStrictEqual(overlay.inputs, ["b", "x"]);
            assert.strictEqual(overlay.focused, true);
          }),
        );
      }),
    ));
}

function activeBaseFocusReplacementReceives(): void {
  it("active base focus replacement receives close input before overlay restore", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const replacement = new FocusableOverlay(["REPLACEMENT"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            overlay.handleInput = (data: string) => {
              overlay.inputs.push(data);
              if (data === "b") {
                tui.setFocus(replacement);
              }
            };
            replacement.handleInput = (data: string) => {
              replacement.inputs.push(data);
              if (data === "\r") {
                tui.setFocus(editor);
              }
            };
            tui.showOverlay(overlay);
            assert.strictEqual(overlay.focused, true);
            terminal.sendInput("b");
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(replacement.focused, true);

            terminal.sendInput("\r");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(replacement.inputs, ["\r"]);
            assert.deepStrictEqual(overlay.inputs, ["b"]);
            assert.strictEqual(overlay.focused, true);

            terminal.sendInput("x");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(overlay.inputs, ["b", "x"]);
          }),
        );
      }),
    ));
}

function activeReplacementStillReceivesInput(): void {
  it("active replacement still receives input when it is another overlay preFocus", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new FocusableOverlay(["EDITOR"]);
        const replacement = new FocusableOverlay(["REPLACEMENT"]);
        const passive = new FocusableOverlay(["PASSIVE"]);
        const overlay = new FocusableOverlay(["OVERLAY"]);
        yield* withOverlayTui({ focus: editor }, ({ tui, terminal }) =>
          Effect.gen(function* () {
            overlay.handleInput = (data: string) => {
              overlay.inputs.push(data);
              if (data === "b") {
                tui.setFocus(replacement);
              }
            };
            replacement.handleInput = (data: string) => {
              replacement.inputs.push(data);
              if (data === "\r") {
                tui.setFocus(editor);
              }
            };
            tui.setFocus(replacement);
            tui.showOverlay(passive, { nonCapturing: true });
            tui.setFocus(editor);
            tui.showOverlay(overlay);
            terminal.sendInput("b");
            yield* renderAndFlush(tui, terminal);
            assert.strictEqual(replacement.focused, true);

            terminal.sendInput("1");
            terminal.sendInput("\r");
            yield* renderAndFlush(tui, terminal);
            assert.deepStrictEqual(replacement.inputs, ["1", "\r"]);
            assert.deepStrictEqual(overlay.inputs, ["b"]);
            assert.strictEqual(overlay.focused, true);
          }),
        );
      }),
    ));
}
