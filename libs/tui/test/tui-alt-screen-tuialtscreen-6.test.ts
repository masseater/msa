import assert from "node:assert";
import { describe, it } from "node:test";

import { Text } from "../src/components/text.ts";
import { hyperlink } from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { renderFakeCursor } from "../src/tui.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";

describe("TuiAltScreen", () => {
  it("opens an OSC 8 hyperlink with specific or generic release codes, but not on drag", async () => {
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
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<0;2;1M");
    terminal.sendInput("\x1b[<3;2;1m");
    await terminal.waitForRender();
    assert.deepStrictEqual(openedUrls, [url]);

    terminal.sendInput("\x1b[<0;2;2M");
    terminal.sendInput("\x1b[<0;2;2m");
    await terminal.waitForRender();
    assert.deepStrictEqual(openedUrls, [url, belUrl]);

    terminal.sendInput("\x1b[<0;2;3M");
    terminal.sendInput("\x1b[<0;2;3m");
    await terminal.waitForRender();
    assert.deepStrictEqual(openedUrls, [url, belUrl, emojiUrl]);

    terminal.sendInput("\x1b[<0;2;1M");
    terminal.sendInput("\x1b[<32;4;1M");
    terminal.sendInput("\x1b[<0;4;1m");
    await terminal.waitForRender();
    assert.deepStrictEqual(openedUrls, [url, belUrl, emojiUrl]);

    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("selects visible text with the mouse and copies it with OSC 52 after a generic release", async () => {
    const terminal = new RecordingTerminal(20, 4);
    const tui = new TuiAltScreen(terminal);
    tui.addChild(new Text("\x1b[1mal\x1b[0mpha\nbeta\ngamma\ndelta", 0, 0));
    tui.start();
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<0;1;1M");
    terminal.sendInput("\x1b[<32;4;2M");
    terminal.sendInput("\x1b[<3;4;2m");
    await terminal.waitForRender();

    const expectedClipboardSequence = `\x1b]52;c;${Buffer.from("alpha\nbeta").toString("base64")}\x07`;
    const clipboardWrites = terminal.events.filter(
      (event) => event.type === "write" && event.data.includes("\x1b]52;c;"),
    );
    assert.ok(
      clipboardWrites.some(
        (event) => event.type === "write" && event.data.includes(expectedClipboardSequence),
      ),
      JSON.stringify(clipboardWrites),
    );
    assert.ok(
      terminal.events.some((event) => event.type === "write" && event.data.includes("\x1b[7m")),
    );
    assert.ok(
      terminal.events.some(
        (event) => event.type === "write" && event.data.includes("al\x1b[0m\x1b[7mpha"),
      ),
      "selection inverse must be reapplied after a reset inside the selection",
    );
    assert.ok(terminal.getViewport().some((line) => line.includes("Copied!")));

    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("keeps the selection highlight after a fake cursor cell", async () => {
    const terminal = new RecordingTerminal(20, 4);
    const tui = new TuiAltScreen(terminal);
    tui.addChild(new Text(`> ${renderFakeCursor("a")}bcd`, 0, 0));
    tui.start();
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<0;1;1M");
    terminal.sendInput("\x1b[<32;6;1M");
    terminal.sendInput("\x1b[<3;6;1m");
    await terminal.waitForRender();

    assert.ok(
      terminal.events.some(
        (event) => event.type === "write" && event.data.includes("\x1b[27m\x1b[7mbcd"),
      ),
      "selection inverse must be reapplied after the fake cursor ends",
    );

    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("uses an injected copySelection handler instead of OSC 52 and reports success", async () => {
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
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<0;1;1M");
    terminal.sendInput("\x1b[<32;4;2M");
    terminal.sendInput("\x1b[<0;4;2m");
    await terminal.waitForRender();

    assert.deepStrictEqual(copied, ["alpha\nbeta"]);
    assert.ok(
      terminal.events.every(
        (event) => event.type !== "write" || !event.data.includes("\x1b]52;c;"),
      ),
      "must not emit OSC 52 when a copySelection handler is provided",
    );
    assert.ok(terminal.getViewport().some((line) => line.includes("Copied!")));

    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("leaves selections visible without copying when copyOnSelect is disabled", async () => {
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
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<0;1;1M");
    terminal.sendInput("\x1b[<32;4;2M");
    terminal.sendInput("\x1b[<0;4;2m");
    await terminal.waitForRender();

    assert.deepStrictEqual(copied, []);
    assert.strictEqual(tui.hasActiveSelection(), true);
    assert.ok(
      terminal.events.some((event) => event.type === "write" && event.data.includes("\x1b[7m")),
    );
    assert.ok(terminal.getViewport().every((line) => !line.includes("Copied!")));

    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("copies an active selection programmatically", async () => {
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
    await terminal.waitForRender();

    assert.strictEqual(tui.hasActiveSelection(), false);
    assert.strictEqual(await tui.copyActiveSelectionToClipboard(), false);

    terminal.sendInput("\x1b[<0;1;1M");
    terminal.sendInput("\x1b[<32;4;2M");
    terminal.sendInput("\x1b[<0;4;2m");
    await terminal.waitForRender();

    assert.deepStrictEqual(copied, ["alpha\nbeta"]);
    assert.strictEqual(tui.hasActiveSelection(), true);

    copied.length = 0;
    assert.strictEqual(await tui.copyActiveSelectionToClipboard(), true);
    await terminal.waitForRender();

    assert.deepStrictEqual(copied, ["alpha\nbeta"]);
    assert.ok(terminal.getViewport().some((line) => line.includes("Copied!")));

    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("flashes an error when the injected copySelection handler fails", async () => {
    const terminal = new RecordingTerminal(20, 4);
    const tui = new TuiAltScreen(terminal, undefined, undefined, {
      copySelection: () => Promise.resolve(false),
    });
    tui.addChild(new Text("alpha\nbeta\ngamma\ndelta", 0, 0));
    tui.start();
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<0;1;1M");
    terminal.sendInput("\x1b[<32;4;2M");
    terminal.sendInput("\x1b[<0;4;2m");
    await terminal.waitForRender();

    assert.ok(terminal.getViewport().some((line) => line.includes("Copy failed")));
    assert.ok(
      terminal.events.every(
        (event) => event.type !== "write" || !event.data.includes("\x1b]52;c;"),
      ),
      "must not emit OSC 52 when a copySelection handler is provided",
    );

    tui.stop();
  });
});
