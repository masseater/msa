import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI, positionCursor } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

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
    assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 7 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 7 });
  });
}

function movesCorrectlyThroughWrappedVisual(): void {
  it("moves correctly through wrapped visual lines without getting stuck", () => {
    const tui = createTestTUI(15);
    const editor = new Editor(tui, defaultEditorTheme);

    editor.setText("short\n123456789012345678901234567890");
    editor.render(15);

    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 30 });

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
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 20 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
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
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 15 });

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
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 15 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.render(10);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.render(80);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 15 });
  });
}

function rewrappedLinesTargetFitsCurrent(): void {
  it("rewrapped lines: target fits current visual column", () => {
    const tui = createTestTUI(80);
    const editor = new Editor(tui, defaultEditorTheme);
    editor.setText("abcdefghijklmnopqr\n123456789012345678");

    positionCursor(editor, 0, 18);
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 18 });

    editor.render(10);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

    editor.render(80);
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });
  });
}

function rewrappedLinesTargetShorterThan(): void {
  it("rewrapped lines: target shorter than current visual column", () => {
    const tui = createTestTUI(80);
    const editor = new Editor(tui, defaultEditorTheme);
    editor.setText("abcdefghijklmnopqr\n123456789012345678\nab");

    positionCursor(editor, 0, 18);
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 18 });

    editor.render(10);
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

    editor.render(80);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 2 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });
  });
}
