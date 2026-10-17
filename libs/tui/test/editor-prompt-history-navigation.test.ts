import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("limits history to 100 entries", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Add 105 entries
      for (let i = 0; i < 105; i++) {
        editor.addToHistory(`prompt ${i}`);
      }

      // Navigate to oldest
      for (let i = 0; i < 100; i++) {
        editor.handleInput("\x1b[A");
      }

      // Should be at entry 5 (oldest kept), not entry 0
      assert.strictEqual(editor.getText(), "prompt 5");

      // One more Up should not change anything
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "prompt 5");
    });

    it("places cursor at start after browsing history upward", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("older entry");
      editor.addToHistory("line1\nline2\nline3");

      // Up - shows multi-line entry at start
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Up again - immediately navigates to older entry
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "older entry");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("places cursor at end after browsing history downward", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("older entry");
      editor.addToHistory("line1\nline2\nline3");
      editor.addToHistory("newer entry");

      // newer entry
      editor.handleInput("\x1b[A");
      // multi-line entry
      editor.handleInput("\x1b[A");
      // older entry
      editor.handleInput("\x1b[A");

      // Down - shows multi-line entry at end
      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });

      // Down again - immediately navigates to newer entry
      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "newer entry");
    });
  });
});

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("allows opposite-direction cursor movement within multi-line history entry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("line1\nline2\nline3");

      // Up - shows entry at start
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Down - cursor moves to line2
      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

      // Up - cursor moves back to line1
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("public state accessors", () => {
    it("returns cursor position", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      typeText(editor, "abc");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

      // Left
      editor.handleInput("\x1b[D");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });
    });

    it("returns lines as a defensive copy", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.setText("a\nb");

      const lines = editor.getLines();
      assert.deepStrictEqual(lines, ["a", "b"]);

      lines[0] = "mutated";
      assert.deepStrictEqual(editor.getLines(), ["a", "b"]);
    });
  });
});

describe("Editor component", () => {
  describe("Backslash+Enter newline workaround", () => {
    it("inserts backslash immediately (no buffering)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\\");

      // Backslash should be visible immediately, not buffered
      assert.strictEqual(editor.getText(), "\\");
    });

    it("converts standalone backslash to newline on Enter", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\\");
      editor.handleInput("\r");

      assert.strictEqual(editor.getText(), "\n");
    });

    it("inserts backslash normally when followed by other characters", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\\");
      editor.handleInput("x");

      assert.strictEqual(editor.getText(), "\\x");
    });
  });
});

describe("Editor component", () => {
  describe("Backslash+Enter newline workaround", () => {
    it("does not trigger newline when backslash is not immediately before cursor", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let submitted = false;

      editor.onSubmit = () => {
        submitted = true;
      };

      editor.handleInput("\\");
      editor.handleInput("x");
      editor.handleInput("\r");

      // Should submit, not insert newline (backslash not at cursor)
      assert.strictEqual(submitted, true);
    });

    it("only removes one backslash when multiple are present", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\\");
      editor.handleInput("\\");
      editor.handleInput("\\");
      assert.strictEqual(editor.getText(), "\\\\\\");

      editor.handleInput("\r");
      // Only the last backslash is removed, newline inserted
      assert.strictEqual(editor.getText(), "\\\\\n");
    });
  });
});

describe("Editor component", () => {
  describe("Kitty CSI-u handling", () => {
    it("ignores printable CSI-u sequences with unsupported modifiers", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[99;9u");

      assert.strictEqual(editor.getText(), "");
    });

    it("inserts shifted CSI-u letters as text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[69;2u");

      assert.strictEqual(editor.getText(), "E");
    });

    it("inserts shifted xterm modifyOtherKeys letters as text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[27;2;69~");

      assert.strictEqual(editor.getText(), "E");
    });
  });
});
