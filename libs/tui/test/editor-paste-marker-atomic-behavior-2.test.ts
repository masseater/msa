import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("does not crash when text + paste marker exceeds terminal width with cursor on marker", () => {
      const tui = createTestTUI();
      const editor = new Editor(tui, defaultEditorTheme);

      for (let i = 0; i < 35; i++) editor.handleInput("b");

      const bigContent = "line\n".repeat(27).trimEnd();
      editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

      for (let i = 0; i < 4; i++) editor.handleInput("b");

      editor.handleInput("\x1b[D");
      editor.handleInput("\x1b[D");
      editor.handleInput("\x1b[D");
      editor.handleInput("\x1b[D");
      editor.handleInput("\x1b[D");

      const renderWidth = 54;
      const lines = editor.render(renderWidth);
      for (const line of lines) {
        assert.ok(
          visibleWidth(line) <= renderWidth,
          `line exceeds width ${renderWidth}: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
        );
      }
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("wordWrapLine re-checks overflow after backtracking to wrap opportunity", () => {
      const tui = createTestTUI();
      const editor = new Editor(tui, defaultEditorTheme);

      editor.handleInput(" ");
      for (let i = 0; i < 35; i++) editor.handleInput("b");

      const bigContent = "line\n".repeat(27).trimEnd();
      editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

      for (let i = 0; i < 4; i++) editor.handleInput("b");

      const renderWidth = 54;
      const lines = editor.render(renderWidth);
      for (const line of lines) {
        assert.ok(
          visibleWidth(line) <= renderWidth,
          `line exceeds width ${renderWidth}: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
        );
      }
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
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
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("snaps to the paste marker start when navigating down into it", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("12345678901234567890\n\nhello ");

      const bigContent = "x".repeat(2000);
      editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
      editor.render(80);

      const text = editor.getText();
      assert.match(text, /\[paste #\d+ \d+ chars\]/u);

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x01");
      for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 6 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    pasteMarkerAtomicBehaviorCases19();
  });
});

function pasteMarkerAtomicBehaviorCases19(): void {
  it("preserves sticky column when navigating through paste marker line", () => {
    const tui = createTestTUI(30, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    for (const ch of "1234567890123456") editor.handleInput(ch);
    editor.handleInput("\n");
    editor.handleInput("\n");
    editor.handleInput(`\x1b[200~${"x".repeat(2000)}\x1b[201~`);
    editor.handleInput("\n");
    editor.handleInput("\n");
    for (const ch of "abcdefghijklmnop") editor.handleInput(ch);
    editor.render(30);

    for (let i = 0; i < 4; i++) editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 3, col: 0 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 10 });
  });
}
