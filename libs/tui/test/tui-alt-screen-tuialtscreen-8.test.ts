import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { MouseRegion, Text, TuiAltScreen } from "../src/index.ts";
import { toJson } from "./effect-helpers.ts";
import { someWriteSince, trimmedViewport, writesSince } from "./tui-alt-screen-helpers.ts";
import { InputOverlay } from "./tui-alt-screen-input-overlay.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
  it("stacks flash messages and collapses them as they expire", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("one\ntwo\nthree\nfour", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        tui.flash("First", 80);
        tui.flash("Second", 500);
        yield* Effect.promise(() => terminal.waitForRender());
        let viewport = terminal.getViewport();
        assert.ok(viewport[0]?.endsWith(" First "));
        assert.ok(viewport[1]?.endsWith(" Second "));

        yield* Effect.sleep(100);
        yield* Effect.promise(() => terminal.waitForRender());
        viewport = terminal.getViewport();
        assert.ok(viewport[0]?.endsWith(" Second "));
        assert.ok(!viewport.some((line) => line.includes("First")));

        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
  it("snaps mouse selection to CJK, emoji, and combining grapheme boundaries", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 2);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("A界🙂éZ", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        const wideSelection = `\x1b]52;c;${Buffer.from("界🙂").toString("base64")}\x07`;
        terminal.sendInput("\x1b[<0;3;1M");
        terminal.sendInput("\x1b[<32;4;1M");
        terminal.sendInput("\x1b[<0;4;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(
          terminal.events.filter(
            (event) => event.type === "write" && event.data.includes(wideSelection),
          ).length,
          1,
        );

        terminal.sendInput("\x1b[<0;5;1M");
        terminal.sendInput("\x1b[<32;2;1M");
        terminal.sendInput("\x1b[<0;2;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(
          terminal.events.filter(
            (event) => event.type === "write" && event.data.includes(wideSelection),
          ).length,
          2,
        );

        const combiningSelection = `\x1b]52;c;${Buffer.from("éZ").toString("base64")}\x07`;
        terminal.sendInput("\x1b[<0;6;1M");
        terminal.sendInput("\x1b[<32;7;1M");
        terminal.sendInput("\x1b[<0;7;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes(combiningSelection),
          ),
        );

        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("ignores horizontal trackpad wheel events", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(
          new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<66;1;1M");
        terminal.sendInput("\x1b[<67;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 4);
        assert.deepStrictEqual(trimmedViewport(terminal), ["line 5", "line 6", "line 7", "line 8"]);

        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("dispatches clicks to nested mouse regions without breaking drag selection", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 2);
        const tui = new TuiAltScreen(terminal);
        let clicks = 0;
        tui.addChild(
          new MouseRegion(new Text("clickable\nselectable", 0, 0), (event) => {
            if (event.type !== "click") return undefined;
            clicks += 1;
            return { handled: true };
          }),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;2;1M");
        terminal.sendInput("\x1b[<0;2;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(clicks, 1);

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(clicks, 1);
        assert.ok(someWriteSince(terminal, 0, "\x1b]52;c;"));
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("scrolls the transcript on wheel input a focused overlay does not handle", () =>
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
        tui.showOverlay(overlay, { anchor: "top-left", width: 10 });
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(overlay.focused, true);

        terminal.sendInput("\x1b[<64;3;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(tui.viewportTop < topBefore);
        assert.deepStrictEqual(overlay.inputs, []);
        tui.stop();
      }),
    ));
});
