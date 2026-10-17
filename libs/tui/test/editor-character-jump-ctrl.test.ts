import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("cancels backward jump mode when Ctrl+Alt+] is pressed again", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Cursor at end
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      // Ctrl+Alt+] - enter backward jump mode
      editor.handleInput("\x1b\x1d");
      // Ctrl+Alt+] again - cancel
      editor.handleInput("\x1b\x1d");

      // Type 'o' normally - should insert, not jump
      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "hello worldo");
    });

    it("searches for special characters", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("foo(bar) = baz;");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Jump to '('
      // Ctrl+]
      editor.handleInput("\x1d");
      editor.handleInput("(");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

      // Jump to '='
      // Ctrl+]
      editor.handleInput("\x1d");
      editor.handleInput("=");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("handles empty text gracefully", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Ctrl+]
      editor.handleInput("\x1d");
      editor.handleInput("x");

      // Cursor unchanged
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });

    it("resets lastAction when jumping", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");

      // Type to set lastAction to "type-word"
      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "xhello world");

      // Jump forward
      // Ctrl+]
      editor.handleInput("\x1d");
      editor.handleInput("o");

      // Type more - should start a new undo unit (lastAction was reset)
      editor.handleInput("Y");
      assert.strictEqual(editor.getText(), "xhellYo world");

      // Undo should only undo "Y", not "x" as well
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "xhello world");
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("preserves target column when moving up through a shorter line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Line 0: "2222222222x222" (x at col 10)
      // Line 1: "" (empty)
      // Line 2: "1111111111_111111111111" (_ at col 10)
      editor.setText("2222222222x222\n\n1111111111_111111111111");

      // Position cursor on _ (line 2, col 10)
      // At end
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 23 });
      // Ctrl+A - go to start of line
      editor.handleInput("\x01");
      // Move right to col 10
      for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

      // Press Up - should move to empty line (col clamped to 0)
      // Up arrow
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

      // Press Up again - should move to line 0 at col 10 (on 'x')
      // Up arrow
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("preserves target column when moving down through a shorter line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1111111111_111\n\n2222222222x222222222222");

      // Position cursor on _ (line 0, col 10)
      // Up to line 1
      editor.handleInput("\x1b[A");
      // Up to line 0
      editor.handleInput("\x1b[A");
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

      // Press Down - should move to empty line (col clamped to 0)
      // Down arrow
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

      // Press Down again - should move to line 2 at col 10 (on 'x')
      // Down arrow
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on horizontal movement (left arrow)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      // Start at line 2, col 5
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });

      // Move up through empty line
      // Up - line 1, col 0
      editor.handleInput("\x1b[A");
      // Up - line 0, col 5 (sticky)
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

      // Move left - resets sticky column
      // Left
      editor.handleInput("\x1b[D");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

      // Move down twice
      // Down - line 1, col 0
      editor.handleInput("\x1b[B");
      // Down - line 2, col 4 (new sticky from col 4)
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 4 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on horizontal movement (right arrow)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      // Start at line 0, col 5
      // Up to line 1
      editor.handleInput("\x1b[A");
      // Up to line 0
      editor.handleInput("\x1b[A");
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

      // Move down through empty line
      // Down - line 1, col 0
      editor.handleInput("\x1b[B");
      // Down - line 2, col 5 (sticky)
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });

      // Move right - resets sticky column
      // Right
      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 6 });

      // Move up twice
      // Up - line 1, col 0
      editor.handleInput("\x1b[A");
      // Up - line 0, col 6 (new sticky from col 6)
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });
    });
  });
});
