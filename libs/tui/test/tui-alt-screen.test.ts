import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import tuiAltScreenHelpers from "./tui-alt-screen-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const { numberedLines, trimmedViewport, viewportHas } = tuiAltScreenHelpers;

describe("TuiAltScreen", () => {
  it("renders a terminal-height viewport and preserves manual scroll position", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        const text = new Text(
          Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n"),
          0,
          0,
        );
        tui.addChild(text);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(trimmedViewport(terminal), numberedLines(7, 10));
        assert.strictEqual(tui.isFollowingOutput, true);

        terminal.sendInput("\x1b[<64;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), ["line 6", "line 7", "line 8", "line 9"]);
        assert.strictEqual(tui.viewportTop, 5);
        assert.strictEqual(tui.isFollowingOutput, false);

        text.setText(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"));
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), ["line 6", "line 7", "line 8", "line 9"]);

        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("shows a clickable jump-to-end indicator on the transcript's last row while scrolled up", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(30, 6);
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          scrollToEndIndicator: () => "\x1b[7m ↓ Jump to end \x1b[27m",
        });
        const transcript = new ScrollView(
          new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
          { follow: "end", primary: true },
        );
        tui.setLayoutRoot(
          new VStack([
            { basis: 0, component: transcript, grow: 1, minSize: 1 },
            { basis: "auto", component: new Text("editor\nfooter", 0, 0), minSize: 1 },
          ]),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(!viewportHas(terminal, "Jump to end"));

        terminal.sendInput("\x1b[<64;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.isFollowingEnd, false);
        assert.strictEqual(terminal.getViewport()[3], "line 7  ↓ Jump to end         ");
        assert.strictEqual(terminal.getViewport()[4]?.trimEnd(), "editor");

        terminal.sendInput("\x1b[<0;2;4M");
        terminal.sendInput("\x1b[<0;2;4m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.isFollowingEnd, false);

        terminal.sendInput("\x1b[<0;15;4M");
        terminal.sendInput("\x1b[<0;15;4m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.isFollowingEnd, true);
        assert.deepStrictEqual(trimmedViewport(terminal), dockedLines(5, 8));
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("keeps the jump-to-end indicator centered as the auto scrollbar hides and reappears", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(80, 6);
        const label = " ↓ Jump to latest message · End ";
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          scrollToEndIndicator: () => label,
        });
        const transcript = new ScrollView(
          new Text(Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
          { follow: "end", primary: true, scrollbar: "auto", scrollbarHideDelayMs: 0 },
        );
        tui.setLayoutRoot(transcript);
        tui.start();
        yield* Effect.gen(function* () {
          yield* Effect.promise(() => terminal.waitForRender());

          terminal.sendInput("\x1b[<64;80;1M");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(transcript.isScrollbarVisible, true);
          assert.strictEqual(transcript.isFollowingEnd, false);
          const scrollTop = transcript.scrollTop;
          const visibleColumn = terminal.getViewport()[5]?.indexOf(label);

          terminal.sendInput("\x1b[<35;79;1M");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(transcript.isScrollbarVisible, false);
          assert.strictEqual(transcript.scrollTop, scrollTop);
          const hiddenColumn = terminal.getViewport()[5]?.indexOf(label);

          terminal.sendInput("\x1b[<35;80;1M");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(transcript.isScrollbarVisible, true);
          assert.strictEqual(transcript.scrollTop, scrollTop);
          const revealedColumn = terminal.getViewport()[5]?.indexOf(label);

          assert.deepStrictEqual([visibleColumn, hiddenColumn, revealedColumn], [24, 24, 24]);
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

describe("TuiAltScreen", () => {
  it("leaves the scrollbar visible and clickable when the jump-to-end indicator spans the transcript", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(30, 6);
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          scrollToEndIndicator: () => "↓".repeat(30),
        });
        const transcript = new ScrollView(
          new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
          { follow: "end", primary: true, scrollbar: "always" },
        );
        tui.setLayoutRoot(
          new VStack([
            { basis: 0, component: transcript, grow: 1, minSize: 1 },
            { basis: "auto", component: new Text("editor\nfooter", 0, 0), minSize: 1 },
          ]),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<64;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.isFollowingEnd, false);

        assert.strictEqual(terminal.getViewport()[3], `${"↓".repeat(29)}┃`);
        terminal.sendInput("\x1b[<0;30;4M");
        terminal.sendInput("\x1b[<0;30;4m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.isFollowingEnd, false);
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("never shows the jump-to-end indicator for a primary scroll view without follow-end", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(30, 3);
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          scrollToEndIndicator: () => " ↓ Jump to end ",
        });
        const transcript = new ScrollView(new Text("one\ntwo\nthree\nfour\nfive", 0, 0), {
          primary: true,
        });
        tui.setLayoutRoot(transcript);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.strictEqual(transcript.isFollowingEnd, false);
        assert.ok(!viewportHas(terminal, "Jump to end"));
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  tuialtscreenCases1();
});

const dockedLines = (from: number, to: number): string[] => [
  ...numberedLines(from, to),
  "editor",
  "footer",
];

function tuialtscreenCases1(): void {
  it("keeps an explicit dock fixed while the transcript scrolls", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 6);
        const tui = new TuiAltScreen(terminal);
        const transcriptText = new Text(
          Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"),
          0,
          0,
        );
        const transcript = new ScrollView(transcriptText, { follow: "end", primary: true });
        const dock = new VStack([new Text("editor", 0, 0), new Text("footer", 0, 0)]);
        tui.setLayoutRoot(
          new VStack([
            { basis: 0, component: transcript, grow: 1, minSize: 1 },
            { basis: "auto", component: dock, minSize: 1 },
          ]),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(trimmedViewport(terminal), dockedLines(5, 8));

        terminal.sendInput("\x1b[<64;1;6M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), dockedLines(4, 7));
        assert.strictEqual(transcript.isFollowingEnd, false);

        transcriptText.setText(
          Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n"),
        );
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), dockedLines(4, 7));

        tui.scrollToBottom();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), dockedLines(7, 10));
        tui.stop();
      }),
    ));
}
