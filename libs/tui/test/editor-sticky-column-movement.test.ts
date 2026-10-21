import assert from "node:assert";
import { describe, it } from "node:test";

import Editor from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;

const { createTestTUI, positionCursor } = editorHelpers;

describe("Editor component", () => {
  describe("Sticky column", () => {
    handlesMultipleConsecutiveUpDown();
    movesCorrectlyThroughWrappedVisual();
    setsPreferredVisualColPressingRightEnd();
    handlesEditorResizesPreferredVisualColSame();
    handlesEditorResizesPreferredVisualColDifferent();
    rewrappedLinesTargetFitsCurrent();
    rewrappedLinesTargetShorterThan();
  });
});

function handlesMultipleConsecutiveUpDown(): void {
  it("handles multiple consecutive up/down movements", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\nab\ncd\nef\n1234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 7; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 7, line: 4 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 7, line: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 7, line: 4 });
  });
}

function movesCorrectlyThroughWrappedVisual(): void {
  it("moves correctly through wrapped visual lines without getting stuck", () => {
    const tui = createTestTUI(15);
    const editor = new Editor(tui, defaultEditorTheme);

    editor.setText("short\n123456789012345678901234567890");
    editor.render(15);

    assert.deepStrictEqual(editor.getCursor(), { col: 30, line: 1 });

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getCursor().line, 1);

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getCursor().line, 1);

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getCursor().line, 0);
  });
}

function setsPreferredVisualColPressingRightEnd(): void {
  it("sets preferredVisualCol when pressing right at end of prompt (last line)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("111111111x1111111111\n\n333333333_");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x05");
    assert.deepStrictEqual(editor.getCursor(), { col: 20, line: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 2 });

    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 2 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 0 });
  });
}

function handlesEditorResizesPreferredVisualColSame(): void {
  it("handles editor resizes when preferredVisualCol is on the same line", () => {
    const tui = createTestTUI(80);
    const editor = new Editor(tui, defaultEditorTheme);

    editor.setText("12345678901234567890\n\n12345678901234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 15; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 15, line: 0 });

    editor.render(12);

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.equal(editor.getCursor().col, 4);
  });
}

function handlesEditorResizesPreferredVisualColDifferent(): void {
  it("handles editor resizes when preferredVisualCol is on a different line", () => {
    const tui = createTestTUI(80);
    const editor = new Editor(tui, defaultEditorTheme);

    editor.setText("short\n12345678901234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 15; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 15, line: 1 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 0 });

    editor.render(10);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 1 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 0 });

    editor.render(80);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 15, line: 1 });
  });
}

function rewrappedLinesTargetFitsCurrent(): void {
  it("rewrapped lines: target fits current visual column", () => {
    const tui = createTestTUI(80);
    const editor = new Editor(tui, defaultEditorTheme);
    editor.setText("abcdefghijklmnopqr\n123456789012345678");

    positionCursor(editor, 0, 18);
    assert.deepStrictEqual(editor.getCursor(), { col: 18, line: 0 });

    editor.render(10);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 1 });

    editor.render(80);
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 0 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 1 });
  });
}

function rewrappedLinesTargetShorterThan(): void {
  it("rewrapped lines: target shorter than current visual column", () => {
    const tui = createTestTUI(80);
    const editor = new Editor(tui, defaultEditorTheme);
    editor.setText("abcdefghijklmnopqr\n123456789012345678\nab");

    positionCursor(editor, 0, 18);
    assert.deepStrictEqual(editor.getCursor(), { col: 18, line: 0 });

    editor.render(10);
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 1 });

    editor.render(80);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 2, line: 2 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 1 });
  });
}
