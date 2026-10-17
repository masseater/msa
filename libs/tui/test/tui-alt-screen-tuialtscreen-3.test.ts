import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import {
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "../src/keybindings.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  tuialtscreenCases3();
});

function tuialtscreenCases3(): void {
  it("navigates transcript search with hoverable arrow buttons and toggles it with its shortcut", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(120, 6);
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          searchNavigationButtonStyle: (text, hovered) =>
            `${hovered ? "\x1b[45m" : "\x1b[44m"}${text}\x1b[49m`,
        });
        tui.addChild(new Text("needle one\nmiddle\nneedle two\nend", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[102;6u");
        terminal.sendInput("needle");
        yield* Effect.promise(() => terminal.waitForRender());
        let viewport = terminal.getViewport();
        assert.ok(viewport.some((line) => line.includes("1/2")));
        assert.ok(viewport.some((line) => line.includes("↑ Shift+Enter · ↓ Enter")));

        let arrowRow = viewport.findIndex((line) => line.includes("↑") && line.includes("↓"));
        let arrowColumn = viewport[arrowRow]?.lastIndexOf("Enter") ?? -1;
        assert.ok(arrowRow >= 0 && arrowColumn >= 0);
        const hoverEventCount = terminal.events.length;
        terminal.sendInput(`\x1b[<35;${arrowColumn + 1};${arrowRow + 1}M`);
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(
          terminal.events
            .slice(hoverEventCount)
            .some(
              (event) => event.type === "write" && event.data.includes("\x1b[45m↓ Enter\x1b[49m"),
            ),
        );
        terminal.sendInput(`\x1b[<0;${arrowColumn + 1};${arrowRow + 1}M`);
        yield* Effect.promise(() => terminal.waitForRender());
        viewport = terminal.getViewport();
        assert.ok(viewport.some((line) => line.includes("2/2")));
        assert.ok(viewport.some((line) => line.includes("↑ Shift+Enter · ↓ Enter")));

        arrowRow = viewport.findIndex((line) => line.includes("↑") && line.includes("↓"));
        arrowColumn = (viewport[arrowRow]?.indexOf("Shift+Enter") ?? -3) + 3;
        assert.ok(arrowRow >= 0 && arrowColumn >= 0);
        terminal.sendInput(`\x1b[<0;${arrowColumn + 1};${arrowRow + 1}M`);
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(terminal.getViewport().some((line) => line.includes("1/2")));
        assert.ok(terminal.getViewport().some((line) => line.includes("↑ Shift+Enter · ↓ Enter")));

        terminal.sendInput("\x1b[102;6u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(!terminal.getViewport().some((line) => line.includes("↑ Shift+Enter · ↓ Enter")));
        tui.stop();
      }),
    ));
}

describe("TuiAltScreen", () => {
  it("does not treat transcript box drawing as search navigation buttons", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(80, 10);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(
          new Text(
            [
              "needle one",
              "middle",
              "needle two",
              "filler",
              "┌────────────────────────────────────────┐",
              "│ box                                    │",
              "└────────────────────────────────────────┘",
              "end",
            ].join("\n"),
            0,
            0,
          ),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[102;6u");
        terminal.sendInput("needle");
        yield* Effect.promise(() => terminal.waitForRender());
        let viewport = terminal.getViewport();
        assert.ok(viewport.some((line) => line.includes("1/2")));
        assert.ok(!viewport.some((line) => line.includes("2/2")));

        const boxBottomRow = viewport.findIndex((line) => line.startsWith("└"));
        assert.ok(boxBottomRow >= 0);
        terminal.sendInput(`\x1b[<0;24;${boxBottomRow + 1}M`);
        yield* Effect.promise(() => terminal.waitForRender());

        viewport = terminal.getViewport();
        assert.ok(viewport.some((line) => line.includes("1/2")));
        assert.ok(!viewport.some((line) => line.includes("2/2")));
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  it("uses configured styles for current and non-current search matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(60, 4);
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          searchMatchStyle: (text) => `\x1b[41m${text}\x1b[49m`,
          searchCurrentMatchStyle: (text) => `\x1b[42m${text}\x1b[49m`,
        });
        tui.addChild(new Text("needle first\nmiddle\nneedle second\nend", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[102;6u");
        terminal.sendInput("needle");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("\x1b[42mneedle\x1b[49m"),
          ),
        );
        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("\x1b[41mneedle\x1b[49m"),
          ),
        );
        tui.stop();
      }),
    ));
});

describe("TuiAltScreen", () => {
  tuialtscreenCases4();
});

function tuialtscreenCases4(): void {
  it("searches the transcript with Ctrl+Shift+F and restores editor focus on close", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(60, 8);
        const tui = new TuiAltScreen(terminal);
        const transcriptText = new Text(
          Array.from({ length: 12 }, (_, index) => {
            if (index === 4) return "line 5 needle one";
            if (index === 9) return "line 10 needle two";
            return `line ${index + 1}`;
          }).join("\n"),
          0,
          0,
        );
        const transcript = new ScrollView(transcriptText, { follow: "end", primary: true });
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
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[102;6u");
        terminal.sendInput("needle");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.isFollowingEnd, false);
        assert.ok(terminal.getViewport().some((line) => line.includes("2/2")));
        assert.ok(terminal.getViewport().some((line) => line.includes("↑ Shift+Enter · ↓ Enter")));
        assert.ok(terminal.getViewport().some((line) => line.includes("line 10 needle two")));
        assert.deepStrictEqual(editorInputs, []);
        assert.ok(
          terminal.events.some(
            (event) => event.type === "write" && event.data.includes("\x1b[1;7mneedle\x1b[22;27m"),
          ),
        );

        for (let index = 0; index < 6; index++) terminal.sendInput("\x1b[<64;1;4M");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(transcript.scrollTop, 0);
        assert.ok(
          terminal.getViewport().some((line) => line.includes("needle") && line.includes("2/2")),
        );

        terminal.sendInput("\x07");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(terminal.getViewport().some((line) => line.includes("1/2")));
        assert.ok(terminal.getViewport().some((line) => line.includes("line 5 needle one")));

        terminal.sendInput("\x1b[103;6u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(terminal.getViewport().some((line) => line.includes("2/2")));
        assert.ok(terminal.getViewport().some((line) => line.includes("line 10 needle two")));

        terminal.sendInput("\x1b");
        terminal.sendInput("x");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(!terminal.getViewport().some((line) => line.includes("↑ Shift+Enter · ↓ Enter")));
        assert.deepStrictEqual(editorInputs, ["x"]);

        tui.stop();
      }),
    ));
}

describe("TuiAltScreen", () => {
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
});
