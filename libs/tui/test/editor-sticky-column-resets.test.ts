import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Sticky column", () => {
    resetsStickyColumnUndo();
    handlesSetTextResettingStickyColumn();
    resetsStickyColumnTyping();
    resetsStickyColumnBackspace();
    resetsStickyColumnCtrlMove();
    resetsStickyColumnCtrlE();
    resetsStickyColumnWordMovement();
    resetsStickyColumnWordMovement2();
  });
});

function resetsStickyColumnUndo(): void {
  it("resets sticky column on undo", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 8 });

    editor.handleInput("X");
    assert.strictEqual(editor.getText(), "1234567890\n\n12345678X90");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 9 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "1234567890\n\n1234567890");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 8 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });
  });
}

function handlesSetTextResettingStickyColumn(): void {
  it("handles setText resetting sticky column", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[A");

    editor.setText("abcdefghij\n\nabcdefghij");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
  });
}

function resetsStickyColumnTyping(): void {
  it("resets sticky column on typing", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("X");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 9 });
  });
}

function resetsStickyColumnBackspace(): void {
  it("resets sticky column on backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("\x7f");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 7 });
  });
}

function resetsStickyColumnCtrlMove(): void {
  it("resets sticky column on Ctrl+A (move to line start)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x1b[A");

    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
  });
}

function resetsStickyColumnCtrlE(): void {
  it("resets sticky column on Ctrl+E (move to line end)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("12345\n\n1234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 3; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x05");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });
  });
}

function resetsStickyColumnWordMovement(): void {
  it("resets sticky column on word movement (Ctrl+Left)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world\n\nhello world");

    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 11 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 6 });
  });
}

function resetsStickyColumnWordMovement2(): void {
  it("resets sticky column on word movement (Ctrl+Right)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world\n\nhello world");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
  });
}
