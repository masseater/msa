import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
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
  });
});

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
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
  });
});

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
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
  });
});

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
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
  });
});

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
    unicodeTextEditingBehaviorCases1();
  });
});

function unicodeTextEditingBehaviorCases1(): void {
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
