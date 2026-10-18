import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import {
  ScrollView,
  Text,
  TuiAltScreen,
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "../src/index.ts";
import {
  trimmedViewport,
  OSC133_ZONE_START,
  numberedLines,
  mountTranscriptWithEditor,
} from "./tui-alt-screen-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  scrollsTranscriptHalfPageCustom();
  scrollsTranscriptOneLineCustom();
  cases();
  jumpsBetweenOSC133Semantic();
  supportsConfigurableKeyboardViewportNavigation();
});

function scrollsTranscriptHalfPageCustom(): void {
  it("scrolls the transcript by half a page with custom bindings", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const originalKeybindings = getKeybindings();
        const terminal = new VirtualTerminal(20, 10);
        const tui = new TuiAltScreen(terminal);
        setKeybindings(
          new KeybindingsManager(TUI_KEYBINDINGS, {
            "tui.altScreen.halfPageUp": "ctrl+u",
            "tui.altScreen.halfPageDown": "ctrl+d",
          }),
        );
        yield* Effect.gen(function* () {
          tui.addChild(
            new Text(
              Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n"),
              0,
              0,
            ),
          );
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 20);

          terminal.sendInput("\x15");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 15);

          terminal.sendInput("\x04");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 20);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
              setKeybindings(originalKeybindings);
            }),
          ),
        );
      }),
    ));
}

function scrollsTranscriptOneLineCustom(): void {
  it("scrolls the transcript by one line with custom bindings", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const originalKeybindings = getKeybindings();
        const terminal = new VirtualTerminal(20, 10);
        const tui = new TuiAltScreen(terminal);
        setKeybindings(
          new KeybindingsManager(TUI_KEYBINDINGS, {
            "tui.altScreen.lineUp": "ctrl+y",
            "tui.altScreen.lineDown": "ctrl+e",
          }),
        );
        yield* Effect.gen(function* () {
          tui.addChild(
            new Text(
              Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n"),
              0,
              0,
            ),
          );
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 20);

          terminal.sendInput("\x19");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 19);

          terminal.sendInput("\x05");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 20);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
              setKeybindings(originalKeybindings);
            }),
          ),
        );
      }),
    ));
}

function cases(): void {
  it("routes Home and End to the focused component and Ctrl+Home/End to the transcript", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 6);
        const tui = new TuiAltScreen(terminal);
        const transcript = new ScrollView(
          new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
          { follow: "end", primary: true },
        );
        const editorInputs = mountTranscriptWithEditor(tui, transcript);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        const bottom = transcript.scrollTop;
        assert.ok(bottom > 0);

        const editorKeys = ["\x1bOH", "\x1b[F", "\x1b[57423u", "\x1b[5;5~", "\x1b[6;5~"];
        for (const input of editorKeys) terminal.sendInput(input);
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, bottom);
        assert.deepStrictEqual(editorInputs, editorKeys);

        terminal.sendInput("\x1b[1;5H");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, 0);

        terminal.sendInput("\x1b[1;5F");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, bottom);
        assert.strictEqual(transcript.isFollowingEnd, true);

        terminal.sendInput("\x1b[57423;5u");
        terminal.sendInput("\x1b[57423;5:3u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, 0);

        terminal.sendInput("\x1b[6~");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, 1);
        assert.deepStrictEqual(editorInputs, editorKeys);

        tui.stop();
      }),
    ));
}

function jumpsBetweenOSC133Semantic(): void {
  it("jumps between OSC 133 semantic prompt markers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
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
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 5);

        terminal.sendInput("\x1b[57419;6u");
        terminal.sendInput("\x1b[57419;6:3u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 4);
        assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 3");

        terminal.sendInput("\x1b[1;6A");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 2);
        assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 2");

        terminal.sendInput("\x1b[57420;6u");
        terminal.sendInput("\x1b[57420;6:3u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 4);
        assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 3");

        terminal.sendInput("\x1b[1;6B");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 5);
        assert.strictEqual(terminal.getViewport()[1]?.trimEnd(), "message 4");
        assert.strictEqual(tui.isFollowingOutput, true);

        tui.stop();
      }),
    ));
}

function supportsConfigurableKeyboardViewportNavigation(): void {
  it("supports configurable keyboard viewport navigation with four rows of page overlap", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 8);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(
          new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[57421u");
        terminal.sendInput("\x1b[57421;1:3u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), numberedLines(1, 8));

        terminal.sendInput("\x1b[57422u");
        terminal.sendInput("\x1b[57422;1:3u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), numberedLines(5, 12));

        terminal.sendInput("\x1b[7^");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), numberedLines(1, 8));

        terminal.sendInput("\x1b[8^");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.deepStrictEqual(trimmedViewport(terminal), numberedLines(5, 12));

        tui.stop();
      }),
    ));
}
