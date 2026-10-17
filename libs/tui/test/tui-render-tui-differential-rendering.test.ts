import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { TestComponent } from "./tui-render-test-component.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI differential rendering", () => {
  it("renders correctly when first line changes but rest stays same", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        component.lines = ["CHANGED", "Line 1", "Line 2", "Line 3"];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        const viewport = terminal.getViewport();
        assert.ok(viewport[0]?.includes("CHANGED"), `First line changed: ${viewport[0]}`);
        assert.ok(viewport[1]?.includes("Line 1"), `Line 1 preserved: ${viewport[1]}`);
        assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
        assert.ok(viewport[3]?.includes("Line 3"), `Line 3 preserved: ${viewport[3]}`);

        tui.stop();
      }),
    ));
});

describe("TUI differential rendering", () => {
  it("renders correctly when last line changes but rest stays same", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        component.lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        component.lines = ["Line 0", "Line 1", "Line 2", "CHANGED"];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        const viewport = terminal.getViewport();
        assert.ok(viewport[0]?.includes("Line 0"), `Line 0 preserved: ${viewport[0]}`);
        assert.ok(viewport[1]?.includes("Line 1"), `Line 1 preserved: ${viewport[1]}`);
        assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
        assert.ok(viewport[3]?.includes("CHANGED"), `Last line changed: ${viewport[3]}`);

        tui.stop();
      }),
    ));
});

describe("TUI differential rendering", () => {
  it("renders correctly when multiple non-adjacent lines change", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        component.lines = ["Line 0", "Line 1", "Line 2", "Line 3", "Line 4"];
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        component.lines = ["Line 0", "CHANGED 1", "Line 2", "CHANGED 3", "Line 4"];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        const viewport = terminal.getViewport();
        assert.ok(viewport[0]?.includes("Line 0"), `Line 0 preserved: ${viewport[0]}`);
        assert.ok(viewport[1]?.includes("CHANGED 1"), `Line 1 changed: ${viewport[1]}`);
        assert.ok(viewport[2]?.includes("Line 2"), `Line 2 preserved: ${viewport[2]}`);
        assert.ok(viewport[3]?.includes("CHANGED 3"), `Line 3 changed: ${viewport[3]}`);
        assert.ok(viewport[4]?.includes("Line 4"), `Line 4 preserved: ${viewport[4]}`);

        tui.stop();
      }),
    ));
});

describe("TUI differential rendering", () => {
  it("handles transition from content to empty and back to content", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        component.lines = ["Line 0", "Line 1", "Line 2"];
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        let viewport = terminal.getViewport();
        assert.ok(viewport[0]?.includes("Line 0"), "Initial content rendered");

        component.lines = [];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        component.lines = ["New Line 0", "New Line 1"];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        viewport = terminal.getViewport();
        assert.ok(viewport[0]?.includes("New Line 0"), `New content rendered: ${viewport[0]}`);
        assert.ok(viewport[1]?.includes("New Line 1"), `New content line 1: ${viewport[1]}`);

        tui.stop();
      }),
    ));
});

describe("TUI differential rendering", () => {
  it("full re-renders when deleted lines move the viewport upward", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 5);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        component.lines = Array.from({ length: 12 }, (_, i) => `Line ${i}`);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        const initialRedraws = tui.fullRedraws;

        component.lines = Array.from({ length: 7 }, (_, i) => `Line ${i}`);
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(tui.fullRedraws > initialRedraws, "Shrink should trigger a full redraw");
        assert.deepStrictEqual(terminal.getViewport(), [
          "Line 2",
          "Line 3",
          "Line 4",
          "Line 5",
          "Line 6",
        ]);

        tui.stop();
      }),
    ));
});

describe("TUI differential rendering", () => {
  it("appends after a shrink without another full redraw once the viewport is reset", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 5);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        component.lines = Array.from({ length: 8 }, (_, i) => `Line ${i}`);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        const initialRedraws = tui.fullRedraws;

        component.lines = ["Line 0", "Line 1"];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(
          tui.fullRedraws > initialRedraws,
          "Shrink should reset the viewport with a full redraw",
        );
        const redrawsAfterShrink = tui.fullRedraws;

        component.lines = ["Line 0", "Line 1", "Line 2"];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.strictEqual(
          tui.fullRedraws,
          redrawsAfterShrink,
          "Append should stay on the differential path",
        );
        assert.deepStrictEqual(terminal.getViewport(), ["Line 0", "Line 1", "Line 2", "", ""]);

        tui.stop();
      }),
    ));
});

const expectedAfterSwitch = [
  "Chat 5",
  "Chat 6",
  "Chat 7",
  "Chat 8",
  "Chat 9",
  "Chat 10",
  "Chat 11",
  "Editor 0",
  "Editor 1",
  "Editor 2",
];

function assertNoStaleChat(viewport: string[]): void {
  for (let i = 0; i < 10; i++) {
    const line = viewport[i] ?? "";
    assert.ok(!line.includes("Chat 12"), `Stale "Chat 12" at viewport row ${i}`);
    assert.ok(!line.includes("Chat 13"), `Stale "Chat 13" at viewport row ${i}`);
    assert.ok(!line.includes("Chat 14"), `Stale "Chat 14" at viewport row ${i}`);
  }
  assert.deepStrictEqual(viewport, expectedAfterSwitch);
}

describe("TUI differential rendering", () => {
  tuiDifferentialRenderingCases3();
});

function tuiDifferentialRenderingCases3(): void {
  it("clears stale content when maxLinesRendered was inflated by a transient component", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        const chat = new TestComponent();
        const editor = new TestComponent();
        tui.addChild(chat);
        tui.addChild(editor);

        const longChat = Array.from({ length: 15 }, (_, i) => `Chat ${i}`);
        const shortChat = Array.from({ length: 12 }, (_, i) => `Chat ${i}`);
        const editorLines = ["Editor 0", "Editor 1", "Editor 2"];
        const selectorLines = Array.from({ length: 8 }, (_, i) => `Selector ${i}`);

        chat.lines = longChat;
        editor.lines = editorLines;
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        editor.lines = selectorLines;
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        editor.lines = editorLines;
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        const redrawsBeforeSwitch = tui.fullRedraws;
        chat.lines = shortChat;
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(
          tui.fullRedraws > redrawsBeforeSwitch,
          "Branch switch should trigger a full redraw",
        );

        assertNoStaleChat(terminal.getViewport());

        tui.stop();
      }),
    ));
}
