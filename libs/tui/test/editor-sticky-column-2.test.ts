import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Sticky column", () => {
    stickyColumnCases17();
  });
});

function stickyColumnCases17(): void {
  it("resets sticky column on undo", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    // Go to line 0, col 8
    // Up to line 1
    editor.handleInput("\x1b[A");
    // Up to line 0
    editor.handleInput("\x1b[A");
    // Ctrl+A
    editor.handleInput("\x01");
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    // Move down through empty line - establishes sticky col 8
    // Down - line 1, col 0
    editor.handleInput("\x1b[B");
    // Down - line 2, col 8 (sticky)
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 8 });

    // Type something to create undo state - this clears sticky and sets col to 9
    editor.handleInput("X");
    assert.strictEqual(editor.getText(), "1234567890\n\n12345678X90");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 9 });

    // Move up - establishes new sticky col 9
    // Up - line 1, col 0
    editor.handleInput("\x1b[A");
    // Up - line 0, col 9
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });

    // Undo - resets sticky column and restores cursor to line 2, col 8
    // Ctrl+- (undo)
    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "1234567890\n\n1234567890");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 8 });

    // Move up - should capture new sticky from restored col 8, not old col 9
    // Up - line 1, col 0
    editor.handleInput("\x1b[A");
    // Up - line 0, col 8 (new sticky from restored position)
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });
  });
}

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("handles multiple consecutive up/down movements", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\nab\ncd\nef\n1234567890");

      // Start at line 4, col 7
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 7; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 7 });

      // Move up multiple times through short lines
      // Up - line 3, col 2 (clamped)
      editor.handleInput("\x1b[A");
      // Up - line 2, col 2 (clamped)
      editor.handleInput("\x1b[A");
      // Up - line 1, col 2 (clamped)
      editor.handleInput("\x1b[A");
      // Up - line 0, col 7 (restored)
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

      // Move down multiple times - sticky should still be 7
      // Down - line 1, col 2
      editor.handleInput("\x1b[B");
      // Down - line 2, col 2
      editor.handleInput("\x1b[B");
      // Down - line 3, col 2
      editor.handleInput("\x1b[B");
      // Down - line 4, col 7 (restored)
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 7 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("moves correctly through wrapped visual lines without getting stuck", () => {
      // Narrow terminal
      const tui = createTestTUI(15, 24);
      const editor = new Editor(tui, defaultEditorTheme);

      // Line 0: short
      // Line 1: 30 chars = wraps to 3 visual lines at width 10 (after padding)
      editor.setText("short\n123456789012345678901234567890");
      // This gives 14 layout width
      editor.render(15);

      // Position at end of line 1 (col 30)
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 30 });

      // Move up repeatedly - should traverse all visual lines of the wrapped text
      // and eventually reach line 0
      // Up - to previous visual line within line 1
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getCursor().line, 1);

      // Up - another visual line
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getCursor().line, 1);

      // Up - should reach line 0
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getCursor().line, 0);
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("handles setText resetting sticky column", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      // Establish sticky column
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");
      // Up
      editor.handleInput("\x1b[A");

      // setText should reset sticky column
      editor.setText("abcdefghij\n\nabcdefghij");
      // At end
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

      // Move up - should capture new sticky from current position (10)
      // Up - line 1, col 0
      editor.handleInput("\x1b[A");
      // Up - line 0, col 10
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("sets preferredVisualCol when pressing right at end of prompt (last line)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Line 0: 20 chars with 'x' at col 10
      // Line 1: empty
      // Line 2: 10 chars ending with '_'
      editor.setText("111111111x1111111111\n\n333333333_");

      // Go to line 0, press Ctrl+E (end of line) - col 20
      // Up to line 1
      editor.handleInput("\x1b[A");
      // Up to line 0
      editor.handleInput("\x1b[A");
      // Ctrl+E - move to end of line
      editor.handleInput("\x05");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 20 });

      // Move down to line 2 - cursor clamped to col 10 (end of line)
      // Down to line 1, col 0
      editor.handleInput("\x1b[B");
      // Down to line 2, col 10 (clamped)
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

      // Press Right at end of prompt - nothing visible happens, but sets preferredVisualCol to 10
      // Right - can't move, but sets preferredVisualCol
      editor.handleInput("\x1b[C");
      // Still at same position
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

      // Move up twice to line 0 - should use preferredVisualCol (10) to land on 'x'
      // Up to line 1, col 0
      editor.handleInput("\x1b[A");
      // Up to line 0, col 10 (on 'x')
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("handles editor resizes when preferredVisualCol is on the same line", () => {
      // Create editor with wider terminal
      const tui = createTestTUI(80, 24);
      const editor = new Editor(tui, defaultEditorTheme);

      editor.setText("12345678901234567890\n\n12345678901234567890");

      // Start at line 2, col 15
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 15; i++) editor.handleInput("\x1b[C");

      // Move up through empty line - establishes sticky col 15
      // Up
      editor.handleInput("\x1b[A");
      // Up - line 0, col 15
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 15 });

      // Render with narrower width to simulate resize
      // Width 12
      editor.render(12);

      // Move down - sticky should be clamped to new width
      // Down - line 1
      editor.handleInput("\x1b[B");
      // Down - line 2, col should be clamped
      editor.handleInput("\x1b[B");
      assert.equal(editor.getCursor().col, 4);
    });
  });
});
