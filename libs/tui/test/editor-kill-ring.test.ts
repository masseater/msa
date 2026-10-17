import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Alt+Y does nothing if not preceded by yank", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("test");
      // Ctrl+W - deletes "test"
      editor.handleInput("\x17");
      editor.setText("other");

      // Type something to break the yank chain
      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "otherx");

      // Alt+Y should do nothing
      // Alt+Y
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "otherx");
    });

    it("Alt+Y does nothing if kill ring has ≤1 entry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("only");
      // Ctrl+W - deletes "only"
      editor.handleInput("\x17");

      // Ctrl+Y - yanks "only"
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "only");

      // Alt+Y - should do nothing (only 1 entry)
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "only");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("consecutive Ctrl+W accumulates into one kill ring entry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("one two three");
      // Ctrl+W - deletes "three"
      editor.handleInput("\x17");
      // Ctrl+W - deletes "two " (prepended)
      editor.handleInput("\x17");
      // Ctrl+W - deletes "one " (prepended)
      editor.handleInput("\x17");

      assert.strictEqual(editor.getText(), "");

      // Should be one combined entry
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "one two three");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Ctrl+U accumulates multiline deletes including newlines", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Start with multiline text, cursor at end
      editor.setText("line1\nline2\nline3");
      // Cursor is at end of line3 (line 2, col 5)

      // Delete "line3"
      // Ctrl+U
      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "line1\nline2\n");

      // Delete newline (at start of empty line 2, merges with line1)
      // Ctrl+U
      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "line1\nline2");

      // Delete "line2"
      // Ctrl+U
      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "line1\n");

      // Delete newline
      // Ctrl+U
      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "line1");

      // Delete "line1"
      // Ctrl+U
      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "");

      // All deletions accumulated into one entry: "line1\nline2\nline3"
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("backward deletions prepend, forward deletions append during accumulation", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("prefix|suffix");
      // Position cursor at |
      // Ctrl+A
      editor.handleInput("\x01");
      // Move right 6 times
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      // Ctrl+K - deletes "suffix" (forward)
      editor.handleInput("\x0b");
      // Ctrl+K - deletes "|" (forward, appended)
      editor.handleInput("\x0b");
      assert.strictEqual(editor.getText(), "prefix");

      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "prefix|suffix");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("non-delete actions break kill accumulation", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Delete "baz", then type "x" to break accumulation, then delete "x"
      editor.setText("foo bar baz");
      // Ctrl+W - deletes "baz"
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "foo bar ");

      // Typing breaks accumulation
      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "foo bar x");

      // Ctrl+W - deletes "x" (separate entry, not accumulated)
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "foo bar ");

      // Yank most recent - should be "x", not "xbaz"
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "foo bar x");

      // Cycle to previous - should be "baz" (separate entry)
      // Alt+Y
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "foo bar baz");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("non-yank actions break Alt+Y chain", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("first");
      // Ctrl+W
      editor.handleInput("\x17");
      editor.setText("second");
      // Ctrl+W
      editor.handleInput("\x17");
      editor.setText("");

      // Ctrl+Y - yanks "second"
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "second");

      // Type breaks yank chain
      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "secondx");

      // Alt+Y - should do nothing
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "secondx");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("kill ring rotation persists after cycling", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("first");
      // deletes "first"
      editor.handleInput("\x17");
      editor.setText("second");
      // deletes "second"
      editor.handleInput("\x17");
      editor.setText("third");
      // deletes "third"
      editor.handleInput("\x17");
      editor.setText("");

      // Ring: [first, second, third]

      // Ctrl+Y - yanks "third"
      editor.handleInput("\x19");
      // Alt+Y - cycles to "second", ring rotates
      editor.handleInput("\x1by");

      // Now ring is: [third, first, second]
      assert.strictEqual(editor.getText(), "second");

      // Do something else
      editor.handleInput("x");
      editor.setText("");

      // New yank should get "second" (now at end after rotation)
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "second");
    });
  });
});
