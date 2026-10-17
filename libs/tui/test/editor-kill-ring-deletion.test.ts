import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Kill ring", () => {
    ctrlWSavesDeletedText();
    ctrlKSavesDeletedText();
    consecutiveDeletionsAcrossLinesCoalesce();
    ctrlKLineEndDeletes();
    altDDeletesWordForward();
    consecutiveCtrlWAccumulatesInto();
    ctrlUAccumulatesMultilineDeletes();
    backwardDeletionsPrependForwardDeletions();
    nonDeleteActionsBreakKill();
  });
});

function ctrlWSavesDeletedText(): void {
  it("Ctrl+W saves deleted text to kill ring and Ctrl+Y yanks it", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("foo bar baz");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo bar ");

    editor.handleInput("\x01");
    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "bazfoo bar ");
  });
  it("Ctrl+U saves deleted text to kill ring", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");

    editor.handleInput("\x15");
    assert.strictEqual(editor.getText(), "world");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "hello world");
  });
}

function ctrlKSavesDeletedText(): void {
  it("Ctrl+K saves deleted text to kill ring", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01");
    editor.handleInput("\x0b");

    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "hello world");
  });
  it("Ctrl+Y does nothing when kill ring is empty", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("test");
    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "test");
  });
}

function consecutiveDeletionsAcrossLinesCoalesce(): void {
  it("consecutive deletions across lines coalesce into one entry", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1\n2\n3");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "1\n2\n");

    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "1\n2");

    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "1\n");

    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "1");

    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "1\n2\n3");
  });
}

function ctrlKLineEndDeletes(): void {
  it("Ctrl+K at line end deletes newline and coalesces", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("");
    editor.handleInput("a");
    editor.handleInput("b");
    editor.handleInput("\n");
    editor.handleInput("c");
    editor.handleInput("d");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x05");

    editor.handleInput("\x0b");
    assert.strictEqual(editor.getText(), "abcd");

    editor.handleInput("\x0b");
    assert.strictEqual(editor.getText(), "ab");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "ab\ncd");
  });
}

function altDDeletesWordForward(): void {
  it("Alt+D deletes word forward and saves to kill ring", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world test");
    editor.handleInput("\x01");

    editor.handleInput("\x1bd");
    assert.strictEqual(editor.getText(), " world test");

    editor.handleInput("\x1bd");
    assert.strictEqual(editor.getText(), " test");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "hello world test");
  });
  it("Alt+D at end of line deletes newline", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("line1\nline2");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x05");

    editor.handleInput("\x1bd");
    assert.strictEqual(editor.getText(), "line1line2");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "line1\nline2");
  });
}

function consecutiveCtrlWAccumulatesInto(): void {
  it("consecutive Ctrl+W accumulates into one kill ring entry", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("one two three");
    editor.handleInput("\x17");
    editor.handleInput("\x17");
    editor.handleInput("\x17");

    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "one two three");
  });
}

function ctrlUAccumulatesMultilineDeletes(): void {
  it("Ctrl+U accumulates multiline deletes including newlines", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("line1\nline2\nline3");

    editor.handleInput("\x15");
    assert.strictEqual(editor.getText(), "line1\nline2\n");

    editor.handleInput("\x15");
    assert.strictEqual(editor.getText(), "line1\nline2");

    editor.handleInput("\x15");
    assert.strictEqual(editor.getText(), "line1\n");

    editor.handleInput("\x15");
    assert.strictEqual(editor.getText(), "line1");

    editor.handleInput("\x15");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "line1\nline2\nline3");
  });
}

function backwardDeletionsPrependForwardDeletions(): void {
  it("backward deletions prepend, forward deletions append during accumulation", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("prefix|suffix");
    editor.handleInput("\x01");
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x0b");
    editor.handleInput("\x0b");
    assert.strictEqual(editor.getText(), "prefix");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "prefix|suffix");
  });
}

function nonDeleteActionsBreakKill(): void {
  it("non-delete actions break kill accumulation", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("foo bar baz");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo bar ");

    editor.handleInput("x");
    assert.strictEqual(editor.getText(), "foo bar x");

    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo bar ");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "foo bar x");

    editor.handleInput("\x1by");
    assert.strictEqual(editor.getText(), "foo bar baz");
  });
}
