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

      // Delete the last character (ü)
      // Backspace
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

      // Delete the last emoji (👍) - single backspace deletes whole grapheme cluster
      // Backspace
      editor.handleInput("\x7f");

      const text = editor.getText();
      assert.strictEqual(text, "😀");
    });

    it("inserts characters at the correct position after cursor movement over umlauts", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("ä");
      editor.handleInput("ö");
      editor.handleInput("ü");

      // Move cursor left twice
      // Left arrow
      editor.handleInput("\x1b[D");
      // Left arrow
      editor.handleInput("\x1b[D");

      // Insert 'x' in the middle
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

      // Move cursor left over last emoji (🎉) - single arrow moves over whole grapheme
      // Left arrow
      editor.handleInput("\x1b[D");

      // Move cursor left over second emoji (👍)
      editor.handleInput("\x1b[D");

      // Insert 'x' between first and second emoji
      editor.handleInput("x");

      const text = editor.getText();
      assert.strictEqual(text, "😀x👍🎉");
    });

    it("preserves umlauts across line breaks", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("ä");
      editor.handleInput("ö");
      editor.handleInput("ü");
      // new line
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

      // Simulate bracketed paste / programmatic replacement
      editor.setText("Hällö Wörld! 😀 äöüÄÖÜß");

      const text = editor.getText();
      assert.strictEqual(text, "Hällö Wörld! 😀 äöüÄÖÜß");
    });

    it("moves cursor to document start on Ctrl+A and inserts at the beginning", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("a");
      editor.handleInput("b");
      // Ctrl+A (move to start)
      editor.handleInput("\x01");
      // Insert at start
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

    // Basic word deletion
    editor.setText("foo bar baz");
    // Ctrl+W
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo bar ");

    // Trailing whitespace
    editor.setText("foo bar   ");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo ");

    // Punctuation run
    editor.setText("foo bar...");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo bar");

    // ASCII punctuation inside Intl word-like segments preserves old boundaries
    editor.setText("foo.bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo.");

    editor.setText("foo:bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo:");

    // Delete across multiple lines
    editor.setText("line one\nline two");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "line one\nline ");

    // Delete empty line (merge)
    editor.setText("line one\n");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "line one");

    // Grapheme safety (emoji as a word)
    editor.setText("foo 😀😀 bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo 😀😀 ");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo ");

    // Alt+Backspace
    editor.setText("foo bar");
    // Alt+Backspace (legacy)
    editor.handleInput("\x1b\x7f");
    assert.strictEqual(editor.getText(), "foo ");
  });
}
