import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
    navigatesWordsCorrectlyCtrlLeft();
    stopsFullwidthChinesePunctuationIssue();
    handlesMixedCJKASCIIWord();
    insertsMixedASCIIUmlautsEmojis();
    deletesMultiCodeUnitEmojis();
    movesCursorAcrossMultiCode();
    replacesEntireDocumentUnicodeText();
    deletesWordsCorrectlyCtrlW();
  });
});

function navigatesWordsCorrectlyCtrlLeft(): void {
  it("navigates words correctly with Ctrl+Left/Right", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("foo bar... baz");

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 14 });

    editor.setText("   foo bar");
    editor.handleInput("\x01");
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

    editor.setText("foo.bar baz");
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x01");
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
  });
}

function stopsFullwidthChinesePunctuationIssue(): void {
  it("stops at fullwidth Chinese punctuation (issue #4972)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("你好，世界");

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
  });
}

function handlesMixedCJKASCIIWord(): void {
  it("handles mixed CJK and ASCII word movement", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello你好，world世界");

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 13 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 13 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 15 });
  });
}

function insertsMixedASCIIUmlautsEmojis(): void {
  it("inserts mixed ASCII, umlauts, and emojis as literal text", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    typeText(editor, "Hello ");
    editor.handleInput("ä");
    editor.handleInput("ö");
    editor.handleInput("ü");
    editor.handleInput(" ");
    editor.handleInput("😀");

    const text = editor.getText();
    assert.strictEqual(text, "Hello äöü 😀");
  });
  it("deletes single-code-unit unicode characters (umlauts) with Backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("ä");
    editor.handleInput("ö");
    editor.handleInput("ü");

    editor.handleInput("\x7f");

    const text = editor.getText();
    assert.strictEqual(text, "äö");
  });
}

function deletesMultiCodeUnitEmojis(): void {
  it("deletes multi-code-unit emojis with single Backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("😀");
    editor.handleInput("👍");

    editor.handleInput("\x7f");

    const text = editor.getText();
    assert.strictEqual(text, "😀");
  });
  it("inserts characters at the correct position after cursor movement over umlauts", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("ä");
    editor.handleInput("ö");
    editor.handleInput("ü");

    editor.handleInput("\x1b[D");
    editor.handleInput("\x1b[D");

    editor.handleInput("x");

    const text = editor.getText();
    assert.strictEqual(text, "äxöü");
  });
}

function movesCursorAcrossMultiCode(): void {
  it("moves cursor across multi-code-unit emojis with single arrow key", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("😀");
    editor.handleInput("👍");
    editor.handleInput("🎉");

    editor.handleInput("\x1b[D");

    editor.handleInput("\x1b[D");

    editor.handleInput("x");

    const text = editor.getText();
    assert.strictEqual(text, "😀x👍🎉");
  });
  it("preserves umlauts across line breaks", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("ä");
    editor.handleInput("ö");
    editor.handleInput("ü");
    editor.handleInput("\n");
    editor.handleInput("Ä");
    editor.handleInput("Ö");
    editor.handleInput("Ü");

    const text = editor.getText();
    assert.strictEqual(text, "äöü\nÄÖÜ");
  });
}

function replacesEntireDocumentUnicodeText(): void {
  it("replaces the entire document with unicode text via setText (paste simulation)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("Hällö Wörld! 😀 äöüÄÖÜß");

    const text = editor.getText();
    assert.strictEqual(text, "Hällö Wörld! 😀 äöüÄÖÜß");
  });
  it("moves cursor to document start on Ctrl+A and inserts at the beginning", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("a");
    editor.handleInput("b");
    editor.handleInput("\x01");
    editor.handleInput("x");

    const text = editor.getText();
    assert.strictEqual(text, "xab");
  });
}

function deletesWordsCorrectlyCtrlW(): void {
  it("deletes words correctly with Ctrl+W and Alt+Backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("foo bar baz");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo bar ");

    editor.setText("foo bar   ");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo ");

    editor.setText("foo bar...");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo bar");

    editor.setText("foo.bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo.");

    editor.setText("foo:bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo:");

    editor.setText("line one\nline two");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "line one\nline ");

    editor.setText("line one\n");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "line one");

    editor.setText("foo 😀😀 bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo 😀😀 ");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo ");

    editor.setText("foo bar");
    editor.handleInput("\x1b\x7f");
    assert.strictEqual(editor.getText(), "foo ");
  });
}
