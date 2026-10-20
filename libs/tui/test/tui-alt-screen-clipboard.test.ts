import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import tuiModule from "../src/index.ts";
import effectHelpers from "./effect-helpers.ts";
import tuiAltScreenHelpers from "./tui-alt-screen-helpers.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";
import virtualTerminal from "./virtual-terminal.ts";

const { Text, TuiAltScreen } = tuiModule;
const { toJson } = effectHelpers;
const { VirtualTerminal } = virtualTerminal;

const { someWriteSince, viewportHas } = tuiAltScreenHelpers;

describe("TuiAltScreen", () => {
  selectsVisibleTextMouseCopies();
  usesInjectedCopySelectionHandlerInstead();
  leavesSelectionsVisibleWithoutCopying();
  copiesActiveSelectionProgrammatically();
  flashesErrorInjectedCopySelectionHandler();
  flashesSpecificErrorReturnedInjected();
  stacksFlashMessagesCollapsesThem();
});

function selectsVisibleTextMouseCopies(): void {
  it("selects visible text with the mouse and copies it with OSC 52 after a generic release", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(new Text("\x1b[1mal\x1b[0mpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<3;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());

        const expectedClipboardSequence = `\x1b]52;c;${Buffer.from("alpha\nbeta").toString("base64")}\x07`;
        const clipboardWrites = terminal.events.filter(
          (event) => event.type === "write" && event.data.includes("\x1b]52;c;"),
        );
        assert.ok(
          clipboardWrites.some(
            (event) => event.type === "write" && event.data.includes(expectedClipboardSequence),
          ),
          yield* toJson(clipboardWrites),
        );
        assert.ok(someWriteSince(terminal, 0, "\x1b[7m"));
        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("al\x1b[0m\x1b[7mpha"),
          ),
          "selection inverse must be reapplied after a reset inside the selection",
        );
        assert.ok(viewportHas(terminal, "Copied!"));

        tui.stop();
      }),
    ));
}

function usesInjectedCopySelectionHandlerInstead(): void {
  it("uses an injected copySelection handler instead of OSC 52 and reports success", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const copied: string[] = [];
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          copySelection: (text) => {
            copied.push(text);
            return Promise.resolve(true);
          },
        });
        tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(copied, ["alpha\nbeta"]);
        assert.ok(
          terminal.events.every(
            (event) => event.type !== "write" || !event.data.includes("\x1b]52;c;"),
          ),
          "must not emit OSC 52 when a copySelection handler is provided",
        );
        assert.ok(viewportHas(terminal, "Copied!"));

        tui.stop();
      }),
    ));
}

function leavesSelectionsVisibleWithoutCopying(): void {
  it("leaves selections visible without copying when copyOnSelect is disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const copied: string[] = [];
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          copyOnSelect: false,
          copySelection: (text) => {
            copied.push(text);
            return Promise.resolve(true);
          },
        });
        tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(copied, []);
        assert.strictEqual(tui.hasActiveSelection(), true);
        assert.ok(someWriteSince(terminal, 0, "\x1b[7m"));
        assert.ok(terminal.getViewport().every((line) => !line.includes("Copied!")));

        tui.stop();
      }),
    ));
}

function copiesActiveSelectionProgrammatically(): void {
  it("copies an active selection programmatically", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const copied: string[] = [];
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          copySelection: (text) => {
            copied.push(text);
            return Promise.resolve(true);
          },
        });
        tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.strictEqual(tui.hasActiveSelection(), false);
        assert.strictEqual(
          yield* Effect.promise(() => tui.copyActiveSelectionToClipboard()),
          false,
        );

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(copied, ["alpha\nbeta"]);
        assert.strictEqual(tui.hasActiveSelection(), true);

        copied.length = 0;
        assert.strictEqual(yield* Effect.promise(() => tui.copyActiveSelectionToClipboard()), true);
        yield* Effect.promise(() => terminal.waitForRender());

        assert.deepStrictEqual(copied, ["alpha\nbeta"]);
        assert.ok(viewportHas(terminal, "Copied!"));

        tui.stop();
      }),
    ));
}

function flashesErrorInjectedCopySelectionHandler(): void {
  it("flashes an error when the injected copySelection handler fails", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 4);
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          copySelection: () => Promise.resolve(false),
        });
        tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;1;1M");
        terminal.sendInput("\x1b[<32;4;2M");
        terminal.sendInput("\x1b[<0;4;2m");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(viewportHas(terminal, "Copy failed"));
        assert.ok(
          terminal.events.every(
            (event) => event.type !== "write" || !event.data.includes("\x1b]52;c;"),
          ),
          "must not emit OSC 52 when a copySelection handler is provided",
        );

        tui.stop();
      }),
    ));
}

function flashesSpecificErrorReturnedInjected(): void {
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
}

function stacksFlashMessagesCollapsesThem(): void {
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
}
