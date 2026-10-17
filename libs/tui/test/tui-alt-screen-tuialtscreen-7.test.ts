import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Text } from "../src/components/text.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";

describe("TuiAltScreen", () => {
  it("flashes a specific error returned by the injected copySelection handler", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(80, 4);
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          copyOnSelect: false,
          copySelection: () => Promise.resolve("Clipboard unavailable: install wl-clipboard"),
        });
        let flashDuration: number | undefined;
        const flash = tui.flash.bind(tui);
        tui.flash = (message, durationMs) => {
          flashDuration = durationMs;
          flash(message, durationMs);
        };
        tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(
          yield* Effect.promise(() => tui.copyActiveSelectionToClipboard()),
          false,
        );
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(
          terminal
            .getViewport()
            .some((line) => line.includes("Clipboard unavailable: install wl-clipboard")),
        );
        assert.ok(terminal.getViewport().every((line) => !line.includes("Copy failed")));
        assert.strictEqual(flashDuration, 5000);
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("does not append whitespace to double-click word highlighting", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 1);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("foo  bar", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<0;1;1m");
        terminal.sendInput("\x1b[<0;3;1M");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("foo\x1b[27m"),
          ),
        );
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("coalesces slash and hyphen separated segments for double-click word selection", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const { line, needle } of [
          { line: "extensions/starline/fixed-editor/compositor.ts", needle: "starline" },
          { line: "earendil-works/pi-tui", needle: "works" },
        ]) {
          const copied: string[] = [];
          const terminal = new RecordingTerminal(80, 1);
          const tui = new TuiAltScreen(terminal, undefined, undefined, {
            copySelection: (text) => {
              copied.push(text);
              return Promise.resolve(true);
            },
          });
          tui.addChild(new Text(line, 0, 0));
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());

          const oneBasedClickColumn = line.indexOf(needle) + 1;
          terminal.sendInput(`\x1b[<0;${oneBasedClickColumn};1M`);
          terminal.sendInput(`\x1b[<0;${oneBasedClickColumn};1m`);
          terminal.sendInput(`\x1b[<0;${oneBasedClickColumn};1M`);
          terminal.sendInput(`\x1b[<0;${oneBasedClickColumn};1m`);
          yield* Effect.promise(() => terminal.waitForRender());

          assert.deepStrictEqual(copied, [line]);
          tui.stop();
        }
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("highlights a complete whitespace segment during a word drag", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 1);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("foo  bar", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<0;1;1m");
        terminal.sendInput("\x1b[<0;2;1M");
        terminal.sendInput("\x1b[<32;4;1M");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("foo  \x1b[27m"),
          ),
        );
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("selects whole words on double click, extends word drags, and selects lines on triple click", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 2);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("zero alpha beta\ngamma delta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;6;1M");
        terminal.sendInput("\x1b[<0;6;1m");
        terminal.sendInput("\x1b[<0;10;1M");
        terminal.sendInput("\x1b[<0;10;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        const alpha = `\x1b]52;c;${Buffer.from("alpha").toString("base64")}\x07`;
        assert.ok(
          terminal.events.some((event) => event.type === "write" && event.data.includes(alpha)),
        );

        terminal.sendInput("\x1b[<0;12;1M");
        terminal.sendInput("\x1b[<0;12;1m");
        terminal.sendInput("\x1b[<0;14;1M");
        terminal.sendInput("\x1b[<32;3;2M");
        terminal.sendInput("\x1b[<0;3;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        const words = `\x1b]52;c;${Buffer.from("beta\ngamma").toString("base64")}\x07`;
        assert.ok(
          terminal.events.some((event) => event.type === "write" && event.data.includes(words)),
        );

        terminal.sendInput("\x1b[<0;7;2M");
        terminal.sendInput("\x1b[<0;7;2m");
        terminal.sendInput("\x1b[<0;9;2M");
        terminal.sendInput("\x1b[<0;9;2m");
        terminal.sendInput("\x1b[<0;11;2M");
        terminal.sendInput("\x1b[<0;11;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        const line = `\x1b]52;c;${Buffer.from("gamma delta").toString("base64")}\x07`;
        assert.ok(
          terminal.events.some((event) => event.type === "write" && event.data.includes(line)),
        );

        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  tuialtscreenCases8();
});

function tuialtscreenCases8(): void {
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
        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("\x1b[?1004h"),
          ),
        );

        tui.stop();
        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("\x1b[?1004l"),
          ),
        );
      }),
    ));
}

describe("TuiAltScreen", () => {
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
        const focusLossWrites = terminal.events
          .slice(focusLossEventCount)
          .filter((event): event is { type: "write"; data: string } => event.type === "write")
          .map((event) => event.data)
          .join("");
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
});
