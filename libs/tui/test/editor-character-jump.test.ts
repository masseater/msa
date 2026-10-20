import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

const { createTestTUI } = editorHelpers;

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    jumpsForwardFirstOccurrenceCharacter();
    jumpsForwardAcrossMultipleLines();
    jumpsBackwardAcrossMultipleLines();
    doesNothingCharacterNotFound();
    cancelsJumpModeCtrlPressed();
  });
});

function jumpsForwardFirstOccurrenceCharacter(): void {
  it("jumps forward to first occurrence of character on same line", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1d");
    editor.handleInput("o");

    assert.deepStrictEqual(editor.getCursor(), { col: 4, line: 0 });
  });
  it("jumps forward to next occurrence after cursor", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    for (let i = 0; i < 4; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 4, line: 0 });

    editor.handleInput("\x1d");
    editor.handleInput("o");

    assert.deepStrictEqual(editor.getCursor(), { col: 7, line: 0 });
  });
}

function jumpsForwardAcrossMultipleLines(): void {
  it("jumps forward across multiple lines", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("abc\ndef\nghi");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1d");
    editor.handleInput("g");

    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 2 });
  });
  it("jumps backward to first occurrence before cursor on same line", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    assert.deepStrictEqual(editor.getCursor(), { col: 11, line: 0 });

    editor.handleInput("\x1b\x1d");
    editor.handleInput("o");

    assert.deepStrictEqual(editor.getCursor(), { col: 7, line: 0 });
  });
}

function jumpsBackwardAcrossMultipleLines(): void {
  it("jumps backward across multiple lines", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("abc\ndef\nghi");
    assert.deepStrictEqual(editor.getCursor(), { col: 3, line: 2 });

    editor.handleInput("\x1b\x1d");
    editor.handleInput("a");

    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });
  });
  it("does nothing when character is not found (forward)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1d");
    editor.handleInput("z");

    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });
  });
}

function doesNothingCharacterNotFound(): void {
  it("does nothing when character is not found (backward)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    assert.deepStrictEqual(editor.getCursor(), { col: 11, line: 0 });

    editor.handleInput("\x1b\x1d");
    editor.handleInput("z");

    assert.deepStrictEqual(editor.getCursor(), { col: 11, line: 0 });
  });
  it("is case-sensitive", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("Hello World");
    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1d");
    editor.handleInput("h");

    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1d");
    editor.handleInput("W");

    assert.deepStrictEqual(editor.getCursor(), { col: 6, line: 0 });
  });
}

function cancelsJumpModeCtrlPressed(): void {
  it("cancels jump mode when Ctrl+] is pressed again", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1d");
    editor.handleInput("\x1d");

    editor.handleInput("o");
    assert.strictEqual(editor.getText(), "ohello world");
  });
  it("cancels jump mode on Escape and processes the Escape", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1d");
    editor.handleInput("\x1b");

    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("o");
    assert.strictEqual(editor.getText(), "ohello world");
  });
}
