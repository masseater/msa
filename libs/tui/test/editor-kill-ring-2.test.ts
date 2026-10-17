import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("consecutive deletions across lines coalesce into one entry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // "1\n2\n3" with cursor at end, delete everything with Ctrl+W
      editor.setText("1\n2\n3");
      // Ctrl+W - deletes "3"
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "1\n2\n");

      // Ctrl+W - deletes newline (merge with prev line)
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "1\n2");

      // Ctrl+W - deletes "2"
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "1\n");

      // Ctrl+W - deletes newline
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "1");

      // Ctrl+W - deletes "1"
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "");

      // All deletions should have accumulated into one entry
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "1\n2\n3");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Ctrl+K at line end deletes newline and coalesces", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // "ab" on line 1, "cd" on line 2, cursor at end of line 1
      editor.setText("");
      editor.handleInput("a");
      editor.handleInput("b");
      editor.handleInput("\n");
      editor.handleInput("c");
      editor.handleInput("d");
      // Move to end of first line
      // Up arrow
      editor.handleInput("\x1b[A");
      // Ctrl+E - end of line
      editor.handleInput("\x05");

      // Now at end of "ab", Ctrl+K should delete newline (merge with "cd")
      // Ctrl+K - deletes newline
      editor.handleInput("\x0b");
      assert.strictEqual(editor.getText(), "abcd");

      // Continue deleting
      // Ctrl+K - deletes "cd"
      editor.handleInput("\x0b");
      assert.strictEqual(editor.getText(), "ab");

      // Both deletions should accumulate
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "ab\ncd");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("handles yank in middle of text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("word");
      // Ctrl+W - deletes "word"
      editor.handleInput("\x17");
      editor.setText("hello world");

      // Move to middle (after "hello ")
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello wordworld");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("handles yank-pop in middle of text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Create two kill ring entries
      editor.setText("FIRST");
      // Ctrl+W - deletes "FIRST"
      editor.handleInput("\x17");
      editor.setText("SECOND");
      // Ctrl+W - deletes "SECOND"
      editor.handleInput("\x17");

      // Ring: ["FIRST", "SECOND"]

      // Set up "hello world" and position cursor after "hello "
      editor.setText("hello world");
      // Ctrl+A - go to start of line
      editor.handleInput("\x01");
      // Move right 6
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      // Yank "SECOND" in the middle
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello SECONDworld");

      // Yank-pop replaces "SECOND" with "FIRST"
      // Alt+Y
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "hello FIRSTworld");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("multiline yank and yank-pop in middle of text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Create single-line entry
      editor.setText("SINGLE");
      // Ctrl+W - deletes "SINGLE"
      editor.handleInput("\x17");

      // Create multiline entry via consecutive Ctrl+U
      editor.setText("A\nB");
      // Ctrl+U - deletes "B"
      editor.handleInput("\x15");
      // Ctrl+U - deletes newline
      editor.handleInput("\x15");
      // Ctrl+U - deletes "A"
      editor.handleInput("\x15");
      // Ring: ["SINGLE", "A\nB"]

      // Insert in middle of "hello world"
      editor.setText("hello world");
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      // Yank multiline "A\nB"
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello A\nBworld");

      // Yank-pop replaces with "SINGLE"
      // Alt+Y
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "hello SINGLEworld");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Alt+D deletes word forward and saves to kill ring", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world test");
      // Ctrl+A - go to start
      editor.handleInput("\x01");

      // Alt+D - deletes "hello"
      editor.handleInput("\x1bd");
      assert.strictEqual(editor.getText(), " world test");

      // Alt+D - deletes " world" (skips whitespace, then word)
      editor.handleInput("\x1bd");
      assert.strictEqual(editor.getText(), " test");

      // Yank should get accumulated text
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello world test");
    });

    it("Alt+D at end of line deletes newline", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("line1\nline2");
      // Move to start of document, then to end of first line
      // Up arrow - go to first line
      editor.handleInput("\x1b[A");
      // Ctrl+E - end of line
      editor.handleInput("\x05");

      // Alt+D - deletes newline (merges lines)
      editor.handleInput("\x1bd");
      assert.strictEqual(editor.getText(), "line1line2");

      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "line1\nline2");
    });
  });
});
