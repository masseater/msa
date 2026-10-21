import assert from "node:assert";
import { describe, it } from "node:test";

import Editor from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;

const { createTestTUI } = editorHelpers;

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
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 2 });

    editor.handleInput("X");
    assert.strictEqual(editor.getText(), "1234567890\n\n12345678X90");
    assert.deepStrictEqual(editor.getCursor(), { col: 9, line: 2 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 9, line: 0 });

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "1234567890\n\n1234567890");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 2 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 0 });
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
    assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 2 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 0 });
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
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 0 });

    editor.handleInput("X");
    assert.deepStrictEqual(editor.getCursor(), { col: 9, line: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 9, line: 2 });
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
    assert.deepStrictEqual(editor.getCursor(), { col: 8, line: 0 });

    editor.handleInput("\x7f");
    assert.deepStrictEqual(editor.getCursor(), { col: 7, line: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 7, line: 2 });
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
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 1 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });
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
    assert.deepStrictEqual(editor.getCursor(), { col: 3, line: 0 });

    editor.handleInput("\x05");
    assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 2 });
  });
}

function resetsStickyColumnWordMovement(): void {
  it("resets sticky column on word movement (Ctrl+Left)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world\n\nhello world");

    assert.deepStrictEqual(editor.getCursor(), { col: 11, line: 2 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 11, line: 0 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { col: 6, line: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 6, line: 2 });
  });
}

function resetsStickyColumnWordMovement2(): void {
  it("resets sticky column on word movement (Ctrl+Right)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world\n\nhello world");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 2 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 2 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 0 });
  });
}
