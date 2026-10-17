import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Text, TuiAltScreen } from "../src/index.ts";
import { viewportHas } from "./tui-alt-screen-helpers.ts";
import { InputOverlay } from "./tui-alt-screen-input-overlay.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  invalidatesOverlaysExplicitLayoutRoot();
  givesViewportKeysFocusedOverlay();
  keepsViewportScrollingOverlayNot();
  keepsViewportScrollingWhileTranscript();
});

function invalidatesOverlaysExplicitLayoutRoot(): void {
  it("invalidates overlays with an explicit layout root", () => {
    const tui = new TuiAltScreen(new VirtualTerminal());
    const overlay = new Text("overlay", 0, 0);
    let invalidated = false;
    overlay.invalidate = () => {
      invalidated = true;
    };
    tui.setLayoutRoot(new Text("root", 0, 0));
    tui.showOverlay(overlay);

    tui.invalidate();

    assert.strictEqual(invalidated, true);
    tui.stop();
  });
}

function givesViewportKeysFocusedOverlay(): void {
  it("gives viewport keys to a focused overlay", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 6);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(
          new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
        );
        const overlay = new InputOverlay();
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        const topBefore = tui.viewportTop;
        const handle = tui.showOverlay(overlay);
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(overlay.focused, true);

        const keys = ["\x1b[5~", "\x1b[6~", "\x1bOH", "\x1bOF"];
        for (const key of keys) terminal.sendInput(key);
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(overlay.inputs, keys);
        assert.strictEqual(tui.viewportTop, topBefore);

        handle.hide();
        yield* Effect.promise(() => terminal.waitForRender());
        terminal.sendInput("\x1b[5~");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(tui.viewportTop < topBefore);
        tui.stop();
      }),
    ));
}

function keepsViewportScrollingOverlayNot(): void {
  it("keeps viewport scrolling when an overlay is not focused", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 6);
        const tui = new TuiAltScreen(terminal);
        const editor = new InputOverlay();
        tui.addChild(
          new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
        );
        tui.setFocus(editor);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        const topBefore = tui.viewportTop;

        const hidden = tui.showOverlay(new InputOverlay());
        hidden.setHidden(true);
        const nonCapturing = new InputOverlay();
        tui.showOverlay(nonCapturing, { nonCapturing: true });
        const unfocused = new InputOverlay();
        const unfocusedHandle = tui.showOverlay(unfocused);
        unfocusedHandle.unfocus();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(nonCapturing.focused, false);
        assert.strictEqual(unfocused.focused, false);

        terminal.sendInput("\x1b[5~");
        terminal.sendInput("\x1b[<64;10;3M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(tui.viewportTop < topBefore);
        assert.deepStrictEqual(nonCapturing.inputs, []);
        assert.deepStrictEqual(unfocused.inputs, []);
        tui.stop();
      }),
    ));
}

function keepsViewportScrollingWhileTranscript(): void {
  it("keeps viewport scrolling while transcript search is focused", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 6);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(
          new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        const topBefore = tui.viewportTop;

        terminal.sendInput("\x1b[102;6u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(viewportHas(terminal, "↑ ↓"));

        terminal.sendInput("\x1b[5~");
        terminal.sendInput("\x1b[<64;1;4M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(tui.viewportTop < topBefore);
        assert.ok(viewportHas(terminal, "↑ ↓"));
        tui.stop();
      }),
    ));
}
