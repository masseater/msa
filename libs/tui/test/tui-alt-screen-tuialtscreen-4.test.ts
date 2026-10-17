import assert from "node:assert";
import { describe, it } from "node:test";

import { Image } from "../src/components/image.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import {
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "../src/keybindings.ts";
import {
  encodeKitty,
  registerKittyImageMetadata,
  resetCapabilitiesCache,
  setCapabilities,
} from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { OSC133_ZONE_START } from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  it("scrolls the transcript by one line with custom bindings", async () => {
    const originalKeybindings = getKeybindings();
    const terminal = new VirtualTerminal(20, 10);
    const tui = new TuiAltScreen(terminal);
    setKeybindings(
      new KeybindingsManager(TUI_KEYBINDINGS, {
        "tui.altScreen.lineUp": "ctrl+y",
        "tui.altScreen.lineDown": "ctrl+e",
      }),
    );
    try {
      tui.addChild(
        new Text(Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
      );
      tui.start();
      await terminal.waitForRender();
      assert.strictEqual(tui.viewportTop, 20);

      terminal.sendInput("\x19");
      await terminal.waitForRender();
      assert.strictEqual(tui.viewportTop, 19);

      terminal.sendInput("\x05");
      await terminal.waitForRender();
      assert.strictEqual(tui.viewportTop, 20);
    } finally {
      tui.stop();
      setKeybindings(originalKeybindings);
    }
  });
});

describe("TuiAltScreen", () => {
  tuialtscreenCases5();
});

function tuialtscreenCases5(): void {
  it("routes Home and End to the focused component and Ctrl+Home/End to the transcript", async () => {
    const terminal = new VirtualTerminal(20, 6);
    const tui = new TuiAltScreen(terminal);
    const transcript = new ScrollView(
      new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
      { follow: "end", primary: true },
    );
    const editorInputs: string[] = [];
    const editor = {
      focused: false,
      render: () => ["editor"],
      invalidate: () => {},
      handleInput: (data: string) => editorInputs.push(data),
    };
    tui.setLayoutRoot(
      new VStack([
        { component: transcript, basis: 0, grow: 1, minSize: 1 },
        { component: editor, basis: 1, shrink: 0 },
      ]),
    );
    tui.setFocus(editor);
    tui.start();
    await terminal.waitForRender();

    const bottom = transcript.scrollTop;
    assert.ok(bottom > 0);

    // #10314: unmodified Home/End belong to the editor in every UI mode.
    const editorKeys = ["\x1bOH", "\x1b[F", "\x1b[57423u", "\x1b[5;5~", "\x1b[6;5~"];
    for (const input of editorKeys) terminal.sendInput(input);
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, bottom);
    assert.deepStrictEqual(editorInputs, editorKeys);

    terminal.sendInput("\x1b[1;5H");
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, 0);

    terminal.sendInput("\x1b[1;5F");
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, bottom);
    assert.strictEqual(transcript.isFollowingEnd, true);

    terminal.sendInput("\x1b[57423;5u");
    terminal.sendInput("\x1b[57423;5:3u");
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, 0);

    terminal.sendInput("\x1b[6~");
    await terminal.waitForRender();
    assert.strictEqual(transcript.scrollTop, 1);
    assert.deepStrictEqual(editorInputs, editorKeys);

    tui.stop();
  });
}

describe("TuiAltScreen", () => {
  it("jumps between OSC 133 semantic prompt markers", async () => {
    const terminal = new VirtualTerminal(20, 3);
    const tui = new TuiAltScreen(terminal);
    tui.addChild(
      new Text(
        [1, 2, 3, 4]
          .flatMap((message) => [`${OSC133_ZONE_START}message ${message}`, "detail"])
          .join("\n"),
        0,
        0,
      ),
    );
    tui.start();
    await terminal.waitForRender();
    assert.strictEqual(tui.viewportTop, 5);

    terminal.sendInput("\x1b[57419;6u");
    terminal.sendInput("\x1b[57419;6:3u");
    await terminal.waitForRender();
    assert.strictEqual(tui.viewportTop, 4);
    assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 3");

    terminal.sendInput("\x1b[1;6A");
    await terminal.waitForRender();
    assert.strictEqual(tui.viewportTop, 2);
    assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 2");

    terminal.sendInput("\x1b[57420;6u");
    terminal.sendInput("\x1b[57420;6:3u");
    await terminal.waitForRender();
    assert.strictEqual(tui.viewportTop, 4);
    assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 3");

    terminal.sendInput("\x1b[1;6B");
    await terminal.waitForRender();
    assert.strictEqual(tui.viewportTop, 5);
    assert.strictEqual(terminal.getViewport()[1]?.trimEnd(), "message 4");
    assert.strictEqual(tui.isFollowingOutput, true);

    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("does not emit Kitty graphics commands or OSC 133 zones in iTerm2", async () => {
    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
    try {
      const terminal = new RecordingTerminal(20, 3);
      const tui = new TuiAltScreen(terminal);
      tui.addChild({
        render: () => ["\x1b]133;B\x07\x1b]133;C\x07\x1b]133;A\x07content"],
        invalidate: () => {},
      });
      tui.addChild(
        new Image(
          "AAAA",
          "image/png",
          { fallbackColor: (value) => value },
          { filename: "example.png" },
          { widthPx: 10, heightPx: 10 },
        ),
      );
      tui.start();
      await terminal.waitForRender();
      tui.stop();
      assert.ok(
        terminal.events.every((event) => event.type !== "write" || !event.data.includes("\x1b_G")),
      );
      assert.ok(
        terminal.events.every(
          (event) => event.type !== "write" || !event.data.includes("\x1b]133;"),
        ),
      );
      assert.ok(
        terminal.events.every(
          (event) => event.type !== "write" || !event.data.includes("\x1b]1337;File="),
        ),
      );
      assert.ok(
        terminal.events.some((event) => event.type === "write" && event.data.includes("[Image:")),
      );
    } finally {
      resetCapabilitiesCache();
    }
  });
});

describe("TuiAltScreen", () => {
  it("clears stale iTerm2 image placements when they leave the viewport", async () => {
    setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
    try {
      const terminal = new RecordingTerminal(20, 3);
      const tui = new TuiAltScreen(terminal);
      const imageLine = "\x1b]1337;File=inline=1;width=2;height=auto:AAAA\x07";
      tui.addChild({
        render: () => [imageLine, "", "", "after", "more", "end"],
        invalidate: () => {},
      });
      tui.start();
      await terminal.waitForRender();
      tui.scrollToTop();
      await terminal.waitForRender();
      const eventCount = terminal.events.length;

      tui.scrollBy(1);
      await terminal.waitForRender();
      assert.ok(
        terminal.events
          .slice(eventCount)
          .some((event) => event.type === "write" && event.data.includes("\x1b[2J")),
      );
      tui.stop();
    } finally {
      resetCapabilitiesCache();
    }
  });
});

describe("TuiAltScreen", () => {
  it("crops a Kitty image whose first line is above the viewport", async () => {
    const terminal = new RecordingTerminal(20, 3);
    const tui = new TuiAltScreen(terminal);
    const imageId = 123;
    const imageLine = encodeKitty("AAAA", { columns: 2, rows: 3, imageId, moveCursor: false });
    registerKittyImageMetadata({ imageId, columns: 2, rows: 3, widthPx: 100, heightPx: 100 });
    tui.addChild({
      render: () => ["before", imageLine, "", "", "after", "end"],
      invalidate: () => {},
    });
    tui.start();
    await terminal.waitForRender();

    assert.strictEqual(tui.viewportTop, 3);
    assert.ok(
      terminal.events.some(
        (event) =>
          event.type === "write" &&
          event.data.includes("i=123") &&
          event.data.includes("y=66,h=34,r=1"),
      ),
    );

    tui.stop();
  });
});
