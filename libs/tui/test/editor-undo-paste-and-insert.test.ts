import assert from "node:assert";
import { describe, it } from "node:test";

import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

const { applyCompletion, createTestTUI, typeText } = editorHelpers;

describe("Editor component", () => {
  describe("Undo", () => {
    undoesYank();
    doesNotTriggerAutocompleteDuring();
    undoesMultiLinePasteAtomically();
    undoesInsertTextAtCursorAtomically();
    inserttextatcursorHandlesMultilineText();
    inserttextatcursorNormalizesCRLFCRLine();
  });
});

function undoesYank(): void {
  it("undoes yank", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    typeText(editor, "hello ");
    editor.handleInput("\x17");
    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "hello ");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "");
  });
  it("undoes single-line paste atomically", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x1b[200~beep boop\x1b[201~");
    assert.strictEqual(editor.getText(), "hellobeep boop world");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("|");
    assert.strictEqual(editor.getText(), "hello| world");
  });
}

function doesNotTriggerAutocompleteDuring(): void {
  it("does not trigger autocomplete during single-line paste", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let suggestionCalls = 0;

    const mockProvider: AutocompleteProvider = {
      applyCompletion,
      getSuggestions: () => {
        suggestionCalls += 1;
        return Promise.resolve(null);
      },
    };

    editor.setAutocompleteProvider(mockProvider);
    editor.handleInput("\x1b[200~look at @node_modules/react/index.js please\x1b[201~");

    assert.strictEqual(editor.getText(), "look at @node_modules/react/index.js please");
    assert.strictEqual(suggestionCalls, 0);
    assert.strictEqual(editor.isShowingAutocomplete(), false);
  });
  it("decodes CSI-u Ctrl+letter sequences inside bracketed paste (tmux popup)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("\x1b[200~line1\x1b[106;5uline2\x1b[106;5uline3\x1b[201~");
    assert.strictEqual(editor.getText(), "line1\nline2\nline3");
  });
}

function undoesMultiLinePasteAtomically(): void {
  it("undoes multi-line paste atomically", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x1b[200~line1\nline2\nline3\x1b[201~");
    assert.strictEqual(editor.getText(), "helloline1\nline2\nline3 world");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("|");
    assert.strictEqual(editor.getText(), "hello| world");
  });
}

function undoesInsertTextAtCursorAtomically(): void {
  it("undoes insertTextAtCursor atomically", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");

    editor.insertTextAtCursor("/tmp/image.png");
    assert.strictEqual(editor.getText(), "hello/tmp/image.png world");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("|");
    assert.strictEqual(editor.getText(), "hello| world");
  });
}

function inserttextatcursorHandlesMultilineText(): void {
  it("insertTextAtCursor handles multiline text", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");

    editor.insertTextAtCursor("line1\nline2\nline3");
    assert.strictEqual(editor.getText(), "helloline1\nline2\nline3 world");

    const cursor = editor.getCursor();
    assert.strictEqual(cursor.line, 2);
    assert.strictEqual(cursor.col, 5);

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "hello world");
  });
}

function inserttextatcursorNormalizesCRLFCRLine(): void {
  it("insertTextAtCursor normalizes CRLF and CR line endings", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("");

    editor.insertTextAtCursor("a\r\nb\r\nc");
    assert.strictEqual(editor.getText(), "a\nb\nc");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "");

    editor.insertTextAtCursor("x\ry\rz");
    assert.strictEqual(editor.getText(), "x\ny\nz");
  });
  it("undoes setText to empty string", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    typeText(editor, "hello world");
    assert.strictEqual(editor.getText(), "hello world");

    editor.setText("");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "hello world");
  });
}
