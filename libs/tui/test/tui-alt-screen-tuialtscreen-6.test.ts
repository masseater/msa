import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Text } from "../src/components/text.ts";
import { hyperlink } from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { renderFakeCursor } from "../src/tui-component.ts";
import { toJson } from "./effect-helpers.ts";
import { someWriteSince, viewportHas } from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
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
});
