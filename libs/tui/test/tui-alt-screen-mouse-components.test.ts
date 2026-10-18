import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Text, TuiAltScreen, MouseRegion, type TuiMouseEvent } from "../src/index.ts";
import { hyperlink } from "../src/terminal-image.ts";
import { someWriteSince } from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  opensOSC8HyperlinkSpecific();
  dispatchesClicksNestedMouseRegions();
  focusesCapturesDragGesturesMouse();
  reportsConsecutiveClickCountsComponent();
  doesNotRerenderHandledNo();
});

function opensOSC8HyperlinkSpecific(): void {
  it("opens an OSC 8 hyperlink with specific or generic release codes, but not on drag", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 3);
        const openedUrls: string[] = [];
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          openUrl: (url) => openedUrls.push(url),
        });
        const url = "https://example.com/path?q=1";
        const belUrl = "https://example.com/bel";
        const emojiUrl = "https://example.com/emoji";
        tui.addChild(
          new Text(
            `${hyperlink("link", url)}\n\x1b]8;;${belUrl}\x07link\x1b]8;;\x07\n${hyperlink("🙂", emojiUrl)}`,
            0,
            0,
          ),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;2;1M");
        terminal.sendInput("\x1b[<3;2;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(openedUrls, [url]);

        terminal.sendInput("\x1b[<0;2;2M");
        terminal.sendInput("\x1b[<0;2;2m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(openedUrls, [url, belUrl]);

        terminal.sendInput("\x1b[<0;2;3M");
        terminal.sendInput("\x1b[<0;2;3m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(openedUrls, [url, belUrl, emojiUrl]);

        terminal.sendInput("\x1b[<0;2;1M");
        terminal.sendInput("\x1b[<32;4;1M");
        terminal.sendInput("\x1b[<0;4;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(openedUrls, [url, belUrl, emojiUrl]);

        tui.stop();
      }),
    ));
}

function dispatchesClicksNestedMouseRegions(): void {
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
}

function focusesCapturesDragGesturesMouse(): void {
  it("focuses and captures drag gestures for mouse-aware components", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 2);
        const tui = new TuiAltScreen(terminal);
        const events: string[] = [];
        const component = {
          render: () => ["control"],
          invalidate: () => {},
          handleMouse: (event: TuiMouseEvent) => {
            events.push(event.type);
            return event.type === "press"
              ? { handled: true, capture: true, focus: true }
              : { handled: true };
          },
        };
        tui.addChild(component);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;5;2M");
        terminal.sendInput("\x1b[<0;5;2m");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(events, ["press", "drag", "release"]);
        assert.strictEqual(tui.getFocusedComponent(), component);
        tui.stop();
      }),
    ));
}

function reportsConsecutiveClickCountsComponent(): void {
  it("reports consecutive click counts to component-owned controls", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 1);
        const tui = new TuiAltScreen(terminal);
        const clickCounts: number[] = [];
        tui.addChild({
          render: () => ["control"],
          invalidate: () => {},
          handleMouse: (event) => {
            if (event.type === "press") return { handled: true };
            if (event.type === "click") {
              clickCounts.push(event.clickCount ?? 0);
              return { handled: true };
            }
            return undefined;
          },
        });
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        for (let count = 0; count < 3; count++) {
          terminal.sendInput("\x1b[<0;1;1M");
          terminal.sendInput("\x1b[<0;1;1m");
        }
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(clickCounts, [1, 2, 3]);
        tui.stop();
      }),
    ));
}

function doesNotRerenderHandledNo(): void {
  it("does not rerender for handled no-op pointer motion", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 2);
        const tui = new TuiAltScreen(terminal);
        let renderCount = 0;
        tui.addChild({
          render: () => {
            renderCount += 1;
            return ["hover target"];
          },
          invalidate: () => {},
          handleMouse: (event) => (event.type === "move" ? { handled: true } : undefined),
        });
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        const renderedBeforeMotion = renderCount;
        const writesBeforeMotion = terminal.events.filter((event) => event.type === "write").length;

        terminal.sendInput("\x1b[<35;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(renderCount, renderedBeforeMotion);
        assert.strictEqual(
          terminal.events.filter((event) => event.type === "write").length,
          writesBeforeMotion,
        );
        tui.stop();
      }),
    ));
}
