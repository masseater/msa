import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import tuiModule from "../src/index.ts";
import tuiAltScreenHelpers from "./tui-alt-screen-helpers.ts";
import InputOverlay from "./tui-alt-screen-input-overlay.ts";
import VirtualTerminal from "./virtual-terminal.ts";
const { HStack, MouseRegion, ScrollView, SelectList, Text, TuiAltScreen, VStack } = tuiModule;

const { trimmedViewport } = tuiAltScreenHelpers;

describe("TuiAltScreen", () => {
  routesWheelInputScrollView();
  scrollsFasterWhileAltHeld();
  doesNotVerticallyRedispatchMisses();
  appliesRuntimeWheelLineCount();
  chainsUnusedWheelDeltaOuter();
  ignoresHorizontalTrackpadWheelEvents();
  scrollsTranscriptWheelInputFocused();
});

function routesWheelInputScrollView(): void {
  it("routes wheel input to the scroll view under the pointer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        const left = new ScrollView(new Text("a1\na2\na3\na4\na5\na6\na7", 0, 0), {
          follow: "end",
          primary: true,
        });
        const right = new ScrollView(new Text("b1\nb2\nb3\nb4\nb5\nb6\nb7", 0, 0), {
          follow: "end",
        });
        tui.setLayoutRoot(
          new HStack([
            { basis: 10, component: left, shrink: 0 },
            { basis: 10, component: right, shrink: 0 },
          ]),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<64;15;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(left.scrollTop, 3);
        assert.strictEqual(right.scrollTop, 2);
        assert.deepStrictEqual(trimmedViewport(terminal), [
          "a4        b3",
          "a5        b4",
          "a6        b5",
          "a7        b6",
        ]);
        tui.stop();
      }),
    ));
}

function scrollsFasterWhileAltHeld(): void {
  it("scrolls faster while Alt is held during wheel input", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        const text = new Text(
          Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"),
          0,
          0,
        );
        tui.addChild(text);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 8);

        terminal.sendInput("\x1b[<72;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 3);
        tui.stop();
      }),
    ));
}

function doesNotVerticallyRedispatchMisses(): void {
  it("does not vertically redispatch misses through horizontal layout containers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 2);
        const tui = new TuiAltScreen(terminal);
        let selections = 0;
        const list = new SelectList(
          [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
          2,
          {
            description: (text) => text,
            noMatch: (text) => text,
            scrollInfo: (text) => text,
            selectedPrefix: (text) => text,
            selectedText: (text) => text,
          },
        );
        list.onSelect = () => {
          selections += 1;
        };
        tui.setLayoutRoot(
          new HStack([
            { basis: 10, component: list },
            { basis: 10, component: new Text("plain", 0, 0) },
          ]),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;15;1M");
        terminal.sendInput("\x1b[<0;15;1m");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(selections, 0);
        tui.stop();
      }),
    ));
}

function appliesRuntimeWheelLineCount(): void {
  it("applies runtime wheel line count updates", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal, undefined, undefined, { wheelScrollLines: 3 });
        const deltas: Array<number | undefined> = [];
        tui.addChild(
          new MouseRegion(new Text("wheel target", 0, 0), (event) => {
            if (event.type !== "wheel") return undefined;
            deltas.push(event.wheelDelta);
            return { handled: true };
          }),
        );
        tui.start();
        yield* Effect.gen(function* () {
          yield* Effect.promise(() => terminal.waitForRender());
          terminal.sendInput("\x1b[<64;1;1M");
          tui.setWheelScrollLines(2);
          terminal.sendInput("\x1b[<65;1;1M");
          terminal.sendInput("\x1b[<72;1;1M");
          assert.deepStrictEqual(deltas, [-3, 2, -10]);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
            }),
          ),
        );
      }),
    ));
}

function chainsUnusedWheelDeltaOuter(): void {
  it("chains unused wheel delta to an outer scroll view", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal, undefined, undefined, { wheelScrollLines: 3 });
        const inner = new ScrollView(new Text("i1\ni2\ni3\ni4\ni5\ni6", 0, 0));
        const outer = new ScrollView(
          new VStack([
            { basis: 2, component: inner },
            new Text("tail1\ntail2\ntail3\ntail4\ntail5", 0, 0),
          ]),
          { primary: true },
        );
        tui.setLayoutRoot(outer);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<65;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(inner.scrollTop, 3);
        assert.strictEqual(outer.scrollTop, 0);

        terminal.sendInput("\x1b[<65;1;1M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(inner.scrollTop, 4);
        assert.strictEqual(outer.scrollTop, 2);
        tui.stop();
      }),
    ));
}

function ignoresHorizontalTrackpadWheelEvents(): void {
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
}

function scrollsTranscriptWheelInputFocused(): void {
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
}
