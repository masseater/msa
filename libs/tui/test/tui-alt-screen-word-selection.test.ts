import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import tuiModule from "../src/index.ts";
import tuiAltScreenHelpers from "./tui-alt-screen-helpers.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";

const { Text, TuiAltScreen } = tuiModule;

const { someWriteSince } = tuiAltScreenHelpers;

describe("TuiAltScreen", () => {
  doesNotAppendWhitespaceDouble();
  coalescesSlashHyphenSeparatedSegments();
  highlightsCompleteWhitespaceSegmentDuring();
  selectsWholeWordsDoubleClick();
  snapsMouseSelectionCJKEmoji();
});

function doesNotAppendWhitespaceDouble(): void {
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

        assert.ok(someWriteSince(terminal, 0, "foo\x1b[27m"));
        tui.stop();
      }),
    ));
}

function coalescesSlashHyphenSeparatedSegments(): void {
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
}

function highlightsCompleteWhitespaceSegmentDuring(): void {
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

        assert.ok(someWriteSince(terminal, 0, "foo  \x1b[27m"));
        tui.stop();
      }),
    ));
}

function selectsWholeWordsDoubleClick(): void {
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
}

function snapsMouseSelectionCJKEmoji(): void {
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
}
