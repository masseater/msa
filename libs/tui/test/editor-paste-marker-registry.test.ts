import assert from "node:assert";
import { describe, it } from "node:test";

import Editor from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;

const { bigPaste, createTestTUI, pasteWithMarker } = editorHelpers;

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    expandsLargePastedContentLiterally();
    submitsLargePastedContentLiterally();
    undoRestoresMarkerAfterBackspace();
    undoAfterDeletingFirstTwo();
    renumbersPasteRegistryAscendingId();
    undoAfterSetTextRestoresPaste();
  });
});

function expandsLargePastedContentLiterally(): void {
  it("expands large pasted content literally in getExpandedText", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const pastedText = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "tokens $1 $2 $& $$ $` $' end",
    ].join("\n");

    editor.handleInput(`\x1b[200~${pastedText}\x1b[201~`);

    assert.match(editor.getText(), /\[paste #\d+ \+\d+ lines\]/u);
    assert.strictEqual(editor.getExpandedText(), pastedText);
  });
}

function submitsLargePastedContentLiterally(): void {
  it("submits large pasted content literally", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const pastedText = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "tokens $1 $2 $& $$ $` $' end",
    ].join("\n");
    let submitted = "";
    editor.onSubmit = (text) => {
      submitted = text;
    };

    editor.handleInput(`\x1b[200~${pastedText}\x1b[201~`);
    editor.handleInput("\r");

    assert.strictEqual(submitted, pastedText);
  });
}

function undoRestoresMarkerAfterBackspace(): void {
  it("undo restores marker after backspace deletion", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("A");
    pasteWithMarker(editor);
    editor.handleInput("B");

    const textBefore = editor.getText();

    editor.handleInput("\x01");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");

    editor.handleInput("\x7f");
    assert.strictEqual(editor.getText(), "AB");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), textBefore);
  });
  it("undo after paste marker deletion restores the paste registry", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted = "";
    editor.onSubmit = (t) => {
      submitted = t;
    };

    const paste = bigPaste("alpha");
    editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
    editor.handleInput("\x7f");
    editor.handleInput("\x1b[45;5u");
    editor.handleInput("\r");
    assert.strictEqual(submitted, paste);
  });
}

function undoAfterDeletingFirstTwo(): void {
  it("undo after deleting the first of two paste markers restores both registry entries", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted = "";
    editor.onSubmit = (t) => {
      submitted = t;
    };

    const pasteA = bigPaste("alpha");
    const pasteB = bigPaste("beta");
    editor.handleInput(`\x1b[200~${pasteA}\x1b[201~`);
    editor.handleInput(`\x1b[200~${pasteB}\x1b[201~`);
    editor.handleInput("\x01");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x7f");
    editor.handleInput("\x1b[45;5u");
    editor.handleInput("\r");
    assert.strictEqual(submitted, pasteA + pasteB);
  });
}

function renumbersPasteRegistryAscendingId(): void {
  it("renumbers the paste registry in ascending id order when markers are out of order in text", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted = "";
    editor.onSubmit = (t) => {
      submitted = t;
    };

    const pasteA = bigPaste("alpha");
    const pasteB = bigPaste("beta");
    const pasteC = bigPaste("gamma");
    editor.handleInput(`\x1b[200~${pasteA}\x1b[201~`);
    editor.handleInput("\x01");
    editor.handleInput(`\x1b[200~${pasteB}\x1b[201~`);
    editor.handleInput("\x01");
    editor.handleInput(`\x1b[200~${pasteC}\x1b[201~`);
    editor.handleInput("\x05");
    editor.handleInput("\x7f");
    editor.handleInput("\r");
    assert.strictEqual(submitted, pasteC + pasteB);
  });
}

function undoAfterSetTextRestoresPaste(): void {
  it("undo after setText restores paste markers and registry", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted = "";
    editor.onSubmit = (t) => {
      submitted = t;
    };

    const paste = bigPaste("alpha");
    editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
    editor.setText("replacement");
    editor.handleInput("\x1b[45;5u");
    editor.handleInput("\r");
    assert.strictEqual(submitted, paste);
  });
}
