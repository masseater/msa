import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI, pasteWithMarker, positionCursor } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Sticky column", () => {
    stickyColumnCases18();
  });
});

function stickyColumnCases18(): void {
  it("handles editor resizes when preferredVisualCol is on a different line", () => {
    const tui = createTestTUI(80, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    // Create a line that wraps into multiple visual lines at width 10
    // "12345678901234567890" = 20 chars, wraps to 2 visual lines at width 10
    editor.setText("short\n12345678901234567890");

    // Go to line 1, col 15
    // Ctrl+A
    editor.handleInput("\x01");
    for (let i = 0; i < 15; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 15 });

    // Move up to establish sticky col 15
    // Up to line 0
    editor.handleInput("\x1b[A");
    // Line 0 has only 5 chars, so cursor at col 5
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    // Narrow the editor
    editor.render(10);

    // Move down - preferredVisualCol was 15, but width is 10
    // Should land on line 1, clamped to width (visual col 9, which is logical col 9)
    // Down to line 1
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

    // Move up
    // Up - should go to line 0
    editor.handleInput("\x1b[A");
    // Line 0 only has 5 chars
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    // Restore the original width
    editor.render(80);

    // Move down - preferredVisualCol was kept at 15
    // Down to line 1
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 15 });
  });
}

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("rewrapped lines: target fits current visual column", () => {
      const tui = createTestTUI(80, 24);
      const editor = new Editor(tui, defaultEditorTheme);
      editor.setText("abcdefghijklmnopqr\n123456789012345678");

      positionCursor(editor, 0, 18);
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 18 });

      // Narrow to width 10 (layoutWidth = 9).
      // Line 0 last segment has visual col max 9, line 1 first segment max 8
      editor.render(10);

      // Move down: cursor clamps to 8
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

      // Widen back. Move up, the current visual col wins
      editor.render(80);
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

      // Preferred was cleared by the rewrapped branch
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("rewrapped lines: target shorter than current visual column", () => {
      const tui = createTestTUI(80, 24);
      const editor = new Editor(tui, defaultEditorTheme);
      editor.setText("abcdefghijklmnopqr\n123456789012345678\nab");

      positionCursor(editor, 0, 18);
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 18 });

      // Narrow to width 10 (layoutWidth = 9). Moving down clamps to col 8
      editor.render(10);
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

      // Widen the editor
      editor.render(80);

      // Move down to short line "ab".
      // preferredVisualCol is replaced with current visual col (8), cursor clamps to 2
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 2 });

      // Moving up restores to preferred col 8
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("creates a paste marker for large pastes", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const text = pasteWithMarker(editor);
      assert.match(text, /\[paste #\d+ \+\d+ lines\]/u);
    });

    it("treats paste marker as single unit for right arrow", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");
      // Text: "A[paste #1 +20 lines]B", cursor at end

      // Go to start
      // Ctrl+A
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Right arrow: should move past "A"
      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

      // Right arrow: should skip the entire marker
      editor.handleInput("\x1b[C");
      const marker = editor.getText().match(/\[paste #\d+ \+\d+ lines\]/u)![0];
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

      // Right arrow: should move past "B"
      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length + 1 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("treats paste marker as single unit for left arrow", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");
      // Cursor at end

      // Left arrow: past "B"
      editor.handleInput("\x1b[D");
      const text = editor.getText();
      const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u)![0];
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

      // Left arrow: skip the entire marker
      editor.handleInput("\x1b[D");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

      // Left arrow: past "A"
      editor.handleInput("\x1b[D");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("treats paste marker as single unit for backspace", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");

      const text = editor.getText();
      const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u)![0];

      // Position cursor right after the marker (before "B")
      // Ctrl+A
      editor.handleInput("\x01");
      // Move past "A" and the marker
      // past "A"
      editor.handleInput("\x1b[C");
      // past marker
      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

      // Backspace: should delete the entire marker at once
      editor.handleInput("\x7f");
      assert.strictEqual(editor.getText(), "AB");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("treats paste marker as single unit for forward delete", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");

      // Position cursor on "A" (col 0) then move right once to be just before marker
      // Ctrl+A
      editor.handleInput("\x01");
      // past "A", now at col 1 (start of marker)
      editor.handleInput("\x1b[C");

      // Forward delete: should delete the entire marker at once
      // Delete key
      editor.handleInput("\x1b[3~");
      assert.strictEqual(editor.getText(), "AB");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
    });
  });
});
