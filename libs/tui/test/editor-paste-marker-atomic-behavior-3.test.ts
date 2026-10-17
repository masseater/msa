import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    pasteMarkerAtomicBehaviorCases20();
  });
});

function pasteMarkerAtomicBehaviorCases20(): void {
  it("does not get stuck moving down from a multi-visual-line paste marker", () => {
    const tui = createTestTUI(20, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    for (const ch of "abcdefgh") editor.handleInput(ch);
    const bigContent = "line\n".repeat(100).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    for (const ch of "ijklmnopqr") editor.handleInput(ch);
    editor.handleInput("\n");
    for (const ch of "123456789012345678") editor.handleInput(ch);
    editor.render(20);

    const text = editor.getText();
    const markerMatch = text.match(/\[paste #\d+ \+\d+ lines\]/u);
    assert.ok(markerMatch, "paste marker should be created");
    const markerLen = markerMatch[0].length;
    assert.ok(markerLen > 20, "marker should be wider than terminal");
    const markerStart = 8;
    const markerEnd = markerStart + markerLen;

    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: markerStart });

    editor.handleInput("\x1b[B");
    assert.strictEqual(editor.getCursor().line, 0);
    assert.strictEqual(editor.getCursor().col, markerEnd);

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: markerStart });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });
  });
}

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    pasteMarkerAtomicBehaviorCases21();
  });
});

function pasteMarkerAtomicBehaviorCases21(): void {
  it("skips marker continuation VLs when preferred col falls in marker tail", () => {
    const tui = createTestTUI(20, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    for (const ch of "abcdefgh") editor.handleInput(ch);
    const bigContent = "line\n".repeat(100).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    for (const ch of "ijklmnopqr") editor.handleInput(ch);
    editor.handleInput("\n");
    for (const ch of "123456789012345678") editor.handleInput(ch);
    editor.render(20);

    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 3; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x1b[B");
    assert.strictEqual(editor.getCursor().col, 8);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 3 });

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getCursor().col, 8);
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });
  });
}

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
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
  });
});
