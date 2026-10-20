import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Text, TuiAltScreen } from "../src/index.ts";
import { renderFakeCursor } from "../src/tui-component.ts";
import { toJson } from "./effect-helpers.ts";
import tuiAltScreenHelpers from "./tui-alt-screen-helpers.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";

const { someWriteSince, writesSince } = tuiAltScreenHelpers;

describe("TuiAltScreen", () => {
  keepsSelectionHighlightAfterFake();
  doesNotRepaintIdleZero();
  clearsActiveVisibleSelectionFocus();
  retainsCompletedVisibleSelectionAcross();
  autoScrollsExtendsDragSelection();
});

function keepsSelectionHighlightAfterFake(): void {
  it("keeps the selection highlight after a fake cursor cell", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text(`> ${renderFakeCursor("a")}bcd`, 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;6;1M");
        terminal.sendInput("\x1b[<3;6;1m");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("\x1b[27m\x1b[7mbcd"),
          ),
          "selection inverse must be reapplied after the fake cursor ends",
        );

        tui.stop();
      }),
    ));
}

function doesNotRepaintIdleZero(): void {
  it("does not repaint idle or zero-width selections on focus loss", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        const writeCount = () => terminal.events.filter((event) => event.type === "write").length;
        const clipboardWriteCount = () =>
          terminal.events.filter(
            (event) => event.type === "write" && event.data.includes("\x1b]52;c;"),
          ).length;

        const idleWriteCount = writeCount();
        terminal.sendInput("\x1b[O");
        terminal.sendInput("\x1b[I");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(writeCount(), idleWriteCount);

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<0;1;1m");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(clipboardWriteCount(), 0);

        terminal.sendInput("\x1b[<0;1;3M");
        yield* Effect.promise(() => terminal.waitForRender());
        const pressedWriteCount = writeCount();
        terminal.sendInput("\x1b[O");
        terminal.sendInput("\x1b[I");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(writeCount(), pressedWriteCount);
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(clipboardWriteCount(), 0);
        assert.ok(someWriteSince(terminal, 0, "\x1b[?1004h"));

        tui.stop();
        assert.ok(someWriteSince(terminal, 0, "\x1b[?1004l"));
      }),
    ));
}

function clearsActiveVisibleSelectionFocus(): void {
  it("clears an active visible selection on focus loss and ignores orphan events", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        yield* Effect.promise(() => terminal.waitForRender());
        const focusLossEventCount = terminal.events.length;
        terminal.sendInput("\x1b[O");
        terminal.sendInput("\x1b[I");
        yield* Effect.promise(() => terminal.waitForRender());
        const focusLossWrites = writesSince(terminal, focusLossEventCount);
        assert.ok(focusLossWrites.includes("alpha"));
        assert.ok(focusLossWrites.includes("beta"));
        assert.ok(!focusLossWrites.includes("\x1b[7m"));

        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(
          terminal.events.every(
            (event) => event.type !== "write" || !event.data.includes("\x1b]52;c;"),
          ),
        );
        tui.stop();
      }),
    ));
}

function retainsCompletedVisibleSelectionAcross(): void {
  it("retains a completed visible selection across focus changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        const completedWriteCount = terminal.events.filter(
          (event) => event.type === "write",
        ).length;
        terminal.sendInput("\x1b[O");
        terminal.sendInput("\x1b[I");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(
          terminal.events.filter((event) => event.type === "write").length,
          completedWriteCount,
        );

        const redrawEventCount = terminal.events.length;
        tui.renderNow(true);
        const redrawWrites = writesSince(terminal, redrawEventCount);
        assert.ok(redrawWrites.includes("alpha"));
        assert.ok(redrawWrites.includes("beta"));
        assert.ok(redrawWrites.includes("\x1b[7m"));
        tui.stop();
      }),
    ));
}

function autoScrollsExtendsDragSelection(): void {
  it("auto-scrolls and extends a drag selection held at the viewport edge", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(
          new Text(Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 6);

        terminal.sendInput("\x1b[<0;1;3M");
        terminal.sendInput("\x1b[<32;1;1M");
        yield* Effect.sleep(130);
        yield* Effect.promise(() => terminal.waitForRender());

        const selectionTop = tui.viewportTop;
        assert.ok(selectionTop < 6, `expected auto-scroll above row 6, got ${selectionTop}`);
        terminal.sendInput("\x1b[<0;1;1m");
        yield* Effect.promise(() => terminal.waitForRender());

        const selectedLines = Array.from(
          { length: 8 - selectionTop },
          (_, index) => `line ${selectionTop + index + 1}`,
        );
        selectedLines.push("l");
        const expectedClipboardSequence = `\x1b]52;c;${Buffer.from(selectedLines.join("\n")).toString("base64")}\x07`;
        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes(expectedClipboardSequence),
          ),
          yield* toJson(
            terminal.events.filter(
              (event) => event.type === "write" && event.data.includes("\x1b]52;c;"),
            ),
          ),
        );
        tui.stop();
      }),
    ));
}
