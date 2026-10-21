import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import tuiModule from "../src/index.ts";
import tuiAltScreenHelpers from "./tui-alt-screen-helpers.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";
import VirtualTerminal from "./virtual-terminal.ts";

const { ScrollView, Text, TuiAltScreen, VStack } = tuiModule;
const { someWriteSince, viewportHas } = tuiAltScreenHelpers;

const openSearch = (fixture: ReturnType<typeof createSearchFixture>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { terminal, transcript, editorInputs } = fixture;
    terminal.sendInput("\x1b[102;6u");
    terminal.sendInput("needle");
    yield* Effect.promise(() => terminal.waitForRender());
    assert.strictEqual(transcript.isFollowingEnd, false);
    assert.ok(viewportHas(terminal, "2/2"));
    assert.ok(viewportHas(terminal, "↑ Shift+Enter · ↓ Enter"));
    assert.ok(viewportHas(terminal, "line 10 needle two"));
    assert.deepStrictEqual(editorInputs, []);
    assert.ok(someWriteSince(terminal, 0, "\x1b[1;7mneedle\x1b[22;27m"));

    for (let index = 0; index < 6; index++) terminal.sendInput("\x1b[<64;1;4M");
    yield* Effect.promise(() => terminal.waitForRender());
    assert.strictEqual(transcript.scrollTop, 0);
    assert.ok(
      terminal.getViewport().some((line) => line.includes("needle") && line.includes("2/2")),
    );
  });

const navigateAndCloseSearch = (
  fixture: ReturnType<typeof createSearchFixture>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { terminal, editorInputs } = fixture;
    terminal.sendInput("\x07");
    yield* Effect.promise(() => terminal.waitForRender());
    assert.ok(viewportHas(terminal, "1/2"));
    assert.ok(viewportHas(terminal, "line 5 needle one"));

    terminal.sendInput("\x1b[103;6u");
    yield* Effect.promise(() => terminal.waitForRender());
    assert.ok(viewportHas(terminal, "2/2"));
    assert.ok(viewportHas(terminal, "line 10 needle two"));

    terminal.sendInput("\x1b");
    terminal.sendInput("x");
    yield* Effect.promise(() => terminal.waitForRender());
    assert.ok(!viewportHas(terminal, "↑ Shift+Enter · ↓ Enter"));
    assert.deepStrictEqual(editorInputs, ["x"]);
  });

describe("TuiAltScreen", () => {
  navigatesTranscriptSearchHoverableArrow();
  doesNotTreatTranscriptBox();
  usesConfiguredStylesCurrentNon();
  searchesTranscriptCtrlShiftF();
});

function navigatesTranscriptSearchHoverableArrow(): void {
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
        assert.ok(viewportHas(terminal, "1/2"));
        assert.ok(viewportHas(terminal, "↑ Shift+Enter · ↓ Enter"));

        let arrowRow = viewport.findIndex((line) => line.includes("↑") && line.includes("↓"));
        let arrowColumn = viewport[arrowRow]?.lastIndexOf("Enter") ?? -1;
        assert.ok(arrowRow >= 0 && arrowColumn >= 0);
        const hoverEventCount = terminal.events.length;
        terminal.sendInput(`\x1b[<35;${arrowColumn + 1};${arrowRow + 1}M`);
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(someWriteSince(terminal, hoverEventCount, "\x1b[45m↓ Enter\x1b[49m"));
        terminal.sendInput(`\x1b[<0;${arrowColumn + 1};${arrowRow + 1}M`);
        yield* Effect.promise(() => terminal.waitForRender());
        viewport = terminal.getViewport();
        assert.ok(viewportHas(terminal, "2/2"));
        assert.ok(viewportHas(terminal, "↑ Shift+Enter · ↓ Enter"));

        arrowRow = viewport.findIndex((line) => line.includes("↑") && line.includes("↓"));
        arrowColumn = (viewport[arrowRow]?.indexOf("Shift+Enter") ?? -3) + 3;
        assert.ok(arrowRow >= 0 && arrowColumn >= 0);
        terminal.sendInput(`\x1b[<0;${arrowColumn + 1};${arrowRow + 1}M`);
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(viewportHas(terminal, "1/2"));
        assert.ok(viewportHas(terminal, "↑ Shift+Enter · ↓ Enter"));

        terminal.sendInput("\x1b[102;6u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.ok(!viewportHas(terminal, "↑ Shift+Enter · ↓ Enter"));
        tui.stop();
      }),
    ));
}

function doesNotTreatTranscriptBox(): void {
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
}

function usesConfiguredStylesCurrentNon(): void {
  it("uses configured styles for current and non-current search matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(60, 4);
        const tui = new TuiAltScreen(terminal, undefined, undefined, {
          searchCurrentMatchStyle: (text) => `\x1b[42m${text}\x1b[49m`,
          searchMatchStyle: (text) => `\x1b[41m${text}\x1b[49m`,
        });
        tui.addChild(new Text("needle first\nmiddle\nneedle second\nend", 0, 0));
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[102;6u");
        terminal.sendInput("needle");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(someWriteSince(terminal, 0, "\x1b[42mneedle\x1b[49m"));
        assert.ok(someWriteSince(terminal, 0, "\x1b[41mneedle\x1b[49m"));
        tui.stop();
      }),
    ));
}

function searchesTranscriptCtrlShiftF(): void {
  it("searches the transcript with Ctrl+Shift+F and restores editor focus on close", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = createSearchFixture();
        fixture.tui.start();
        yield* Effect.promise(() => fixture.terminal.waitForRender());
        yield* openSearch(fixture);
        yield* navigateAndCloseSearch(fixture);
        fixture.tui.stop();
      }),
    ));
}

function createSearchFixture() {
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
    handleInput: (data: string) => editorInputs.push(data),
    invalidate: () => {},
    render: () => ["editor"],
  };
  tui.setLayoutRoot(
    new VStack([
      { basis: 0, component: transcript, grow: 1, minSize: 1 },
      { basis: 1, component: editor, shrink: 0 },
    ]),
  );
  tui.setFocus(editor);
  return { editorInputs, terminal, transcript, tui };
}
